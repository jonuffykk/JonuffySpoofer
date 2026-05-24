local http = game:GetService("HttpService")
local marketplace = game:GetService("MarketplaceService")

local URL = "http://127.0.0.1:28476"
local POLL_INTERVAL = 2
local connected = false
local totalReplaced = 0
local placeName = "Unknown"
local lastMappingHash = ""
local scanning = false

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 240, 180, 200, 140)
local widget = plugin:CreateDockWidgetPluginGui("JonuffySpoofer", widgetInfo)
widget.Title = "Jonuffy Spoofer"

local frame = Instance.new("Frame")
frame.Size = UDim2.new(1, 0, 1, 0)
frame.BorderSizePixel = 0
frame.Parent = widget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
layout.VerticalAlignment = Enum.VerticalAlignment.Center
layout.Parent = frame

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.new(0.9, 0, 0, 22)
statusLabel.BackgroundTransparency = 1
statusLabel.TextSize = 14
statusLabel.Font = Enum.Font.SourceSansBold
statusLabel.TextXAlignment = Enum.TextXAlignment.Center
statusLabel.Parent = frame

local detailLabel = Instance.new("TextLabel")
detailLabel.Size = UDim2.new(0.9, 0, 0, 36)
detailLabel.BackgroundTransparency = 1
detailLabel.TextSize = 12
detailLabel.TextWrapped = true
detailLabel.Font = Enum.Font.SourceSans
detailLabel.TextXAlignment = Enum.TextXAlignment.Center
detailLabel.Parent = frame

local extraLabel = Instance.new("TextLabel")
extraLabel.Size = UDim2.new(0.9, 0, 0, 28)
extraLabel.BackgroundTransparency = 1
extraLabel.TextSize = 11
extraLabel.TextWrapped = true
extraLabel.Font = Enum.Font.SourceSans
extraLabel.TextXAlignment = Enum.TextXAlignment.Center
extraLabel.Text = ""
extraLabel.Parent = frame

local connectBtn = Instance.new("TextButton")
connectBtn.Size = UDim2.new(0.8, 0, 0, 28)
connectBtn.TextSize = 13
connectBtn.Font = Enum.Font.SourceSansBold
connectBtn.Text = "Connect"
Instance.new("UICorner").Parent = connectBtn
connectBtn.Parent = frame

local function applyTheme()
	local t = settings().Studio.Theme
	frame.BackgroundColor3 = t:GetColor(Enum.StudioStyleGuideColor.MainBackground)
	statusLabel.TextColor3 = t:GetColor(Enum.StudioStyleGuideColor.MainText)
	detailLabel.TextColor3 = t:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	extraLabel.TextColor3 = t:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	connectBtn.BackgroundColor3 = t:GetColor(Enum.StudioStyleGuideColor.Button)
	connectBtn.TextColor3 = t:GetColor(Enum.StudioStyleGuideColor.ButtonText)
end
pcall(applyTheme)
pcall(function() settings().Studio.ThemeChanged:Connect(applyTheme) end)

local function updateUI()
	if connected then
		statusLabel.Text = "Connected"
		statusLabel.TextColor3 = Color3.fromRGB(50, 205, 50)
		detailLabel.Text = placeName .. "  (" .. tostring(game.PlaceId or 0) .. ")"
		extraLabel.Text = scanning and "Scanning..."
			or totalReplaced > 0 and (totalReplaced .. " ID" .. (totalReplaced == 1 and "" or "s") .. " replaced")
			or "Waiting for spoofer..."
		connectBtn.Visible = false
	else
		statusLabel.Text = "Disconnected"
		statusLabel.TextColor3 = Color3.fromRGB(220, 50, 50)
		detailLabel.Text = "Open the Jonuffy Spoofer app"
		extraLabel.Text = "then click Connect below"
		connectBtn.Visible = true
	end
end

local function req(endpoint, method, data)
	local ok, res = pcall(function()
		return http:RequestAsync({
			Url = URL .. endpoint,
			Method = method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = (method ~= "GET" and data) and http:JSONEncode(data) or nil,
		})
	end)
	if not ok then return false, nil end
	local s = res.StatusCode or 0
	if s < 200 or s >= 300 then return false, nil end
	local dok, decoded = pcall(function() return http:JSONDecode(res.Body) end)
	return true, dok and decoded or nil
end

local function getCreatorInfo(info)
	local cType = info.Creator and string.sub(info.Creator.CreatorType or "User", 1, 1) or "U"
	local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "0")
	return cType, cId
end

local function scanAnimations()
	if scanning then return end
	scanning = true
	updateUI()

	local results, seen = {}, {}
	local pending = {}
	local pendingCount = 0
	local function flush(force)
		if pendingCount == 0 then return end
		if not force and pendingCount < 10 then return end
		for _, r in ipairs(pending) do table.insert(results, r) end
		pending = {}
		pendingCount = 0
		req("/scan-result", "POST", { status = "scanning", results = results })
	end

	local descendants = game:GetDescendants()
	for i, obj in ipairs(descendants) do
		if i % 150 == 0 then task.wait() end

		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and not seen[id] then
				local ok, info = pcall(function() return marketplace:GetProductInfo(tonumber(id)) end)
				if ok and info and info.AssetTypeId == 24 then
					local cType, cId = getCreatorInfo(info)
					table.insert(pending, string.format("%s - %s - %s: %s", id, info.Name or "Unknown", cType, cId))
					seen[id] = true
					pendingCount += 1
					flush(false)
				end
			end
		elseif obj:IsA("LuaSourceContainer") then
			local sok, src = pcall(function() return obj.Source end)
			if sok and src and src ~= "" then
				for matchId in src:gmatch("rbxassetid://(%d+)") do
					if not seen[matchId] then
						local ok2, info2 = pcall(function() return marketplace:GetProductInfo(tonumber(matchId)) end)
						if ok2 and info2 and info2.AssetTypeId == 24 then
							local cType, cId = getCreatorInfo(info2)
							table.insert(pending, string.format("%s - %s - %s: %s", matchId, info2.Name or "Unknown", cType, cId))
							seen[matchId] = true
							pendingCount += 1
							flush(false)
						end
					end
				end
			end
		end
	end

	flush(true)
	req("/scan-result", "POST", { status = "completed", results = results })
	scanning = false
	updateUI()
end

local function replaceIds(mappings)
	local idMap = {}
	for _, line in ipairs(mappings) do
		local oldId, newId = line:match("(%d+)%s*=%s*(%d+)")
		if oldId and newId and oldId ~= newId then
			idMap[oldId] = newId
		end
	end
	if not next(idMap) then return end

	local count = 0
	local t0 = tick()
	for _, obj in ipairs(game:GetDescendants()) do
		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.AnimationId = "rbxassetid://" .. idMap[id]
				count = count + 1
			end
		elseif obj:IsA("LuaSourceContainer") then
			local ok, src = pcall(function() return obj.Source end)
			if ok and src then
				local newSrc = src
				for oldId, newId in pairs(idMap) do
					newSrc = newSrc:gsub("rbxassetid://" .. oldId, "rbxassetid://" .. newId)
				end
				if newSrc ~= src then obj.Source = newSrc; count = count + 1 end
			end
		end
	end

	totalReplaced = totalReplaced + count
	req("/replace-complete", "POST", { success = true, replacedCount = count, elapsed = tick() - t0 })
	updateUI()
end

local function doConnect()
	local placeId = game.PlaceId or 0
	local nameOk, info = pcall(function() return placeId > 0 and marketplace:GetProductInfo(placeId).Name or nil end)
	placeName = (nameOk and info) and info or ("Place " .. tostring(placeId))
	local ok = select(1, req("/connect", "POST", { placeId = placeId, placeName = placeName }))
	connected = ok
	return ok
end

local function poll()
	while connected do
		task.wait(POLL_INTERVAL)
		local ok, body = req("/poll", "GET")
		if not ok then
			connected = false
			updateUI()
			break
		end

		if body then
			if body.scanRequest and body.scanRequest.assetType == "Animation" then
				task.spawn(scanAnimations)
			end

			if body.mappings and #body.mappings > 0 then
				local hash = table.concat(body.mappings, "|")
				if hash ~= lastMappingHash then
					lastMappingHash = hash
					task.spawn(function() replaceIds(body.mappings) end)
				end
			end
		end
	end
end

connectBtn.MouseButton1Click:Connect(function()
	detailLabel.Text = "Connecting..."
	connected = false
	updateUI()
	if doConnect() then
		updateUI()
		task.spawn(poll)
	else
		detailLabel.Text = "Failed — is the desktop app running?"
	end
end)

local toolbar = plugin:CreateToolbar("Jonuffy Spoofer")
local toolBtn = toolbar:CreateButton("Jonuffy Spoofer", "Toggle widget", "rbxassetid://133573191144566")
toolBtn.Click:Connect(function() widget.Enabled = not widget.Enabled end)

updateUI()
