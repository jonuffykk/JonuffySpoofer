local httpService = game:GetService("HttpService")
local marketplace = game:GetService("MarketplaceService")

local SERVER_URL = "http://127.0.0.1:28476"
local isConnected = false
local lastMappingsHash = nil

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	true,
	false,
	240,
	160,
	200,
	120
)

local spooferWidget = plugin:CreateDockWidgetPluginGui("SpooferConnectionStatus", widgetInfo)
spooferWidget.Title = "Spoofer Status"

local mainFrame = Instance.new("Frame")
mainFrame.Size = UDim2.new(1, 0, 1, 0)
mainFrame.BorderSizePixel = 0
mainFrame.BackgroundColor3 = Color3.fromRGB(45, 45, 45)
mainFrame.Parent = spooferWidget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 10)
layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
layout.VerticalAlignment = Enum.VerticalAlignment.Center
layout.Parent = mainFrame

local statusText = Instance.new("TextLabel")
statusText.Size = UDim2.new(0.9, 0, 0, 24)
statusText.BackgroundTransparency = 1
statusText.TextColor3 = Color3.fromRGB(220, 220, 220)
statusText.TextSize = 14
statusText.Font = Enum.Font.SourceSansBold
statusText.TextXAlignment = Enum.TextXAlignment.Center
statusText.Parent = mainFrame

local detailsText = Instance.new("TextLabel")
detailsText.Size = UDim2.new(0.9, 0, 0, 40)
detailsText.BackgroundTransparency = 1
detailsText.TextColor3 = Color3.fromRGB(160, 160, 160)
detailsText.TextSize = 12
detailsText.TextWrapped = true
detailsText.Font = Enum.Font.SourceSans
detailsText.TextXAlignment = Enum.TextXAlignment.Center
detailsText.Parent = mainFrame

local reconnectButton = Instance.new("TextButton")
reconnectButton.Size = UDim2.new(0.8, 0, 0, 30)
reconnectButton.BackgroundColor3 = Color3.fromRGB(0, 162, 255)
reconnectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
reconnectButton.TextSize = 14
reconnectButton.Font = Enum.Font.SourceSansBold
reconnectButton.Text = "Reconnect"
local btnCorner = Instance.new("UICorner")
btnCorner.CornerRadius = UDim.new(0, 6)
btnCorner.Parent = reconnectButton
reconnectButton.Parent = mainFrame

local function applyTheme()
	local theme = settings().Studio.Theme
	mainFrame.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainBackground)
	statusText.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainText)
	detailsText.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	reconnectButton.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.Button)
	reconnectButton.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.ButtonText)
end
pcall(applyTheme)
pcall(function()
	settings().Studio.ThemeChanged:Connect(applyTheme)
end)

local function updateUI()
	if isConnected then
		statusText.Text = "Status: Connected"
		statusText.TextColor3 = Color3.fromRGB(50, 205, 50)
		local placeId = game.PlaceId or 0
		detailsText.Text = string.format("Connected to Place %d\n", placeId)
		reconnectButton.Visible = false
	else
		statusText.Text = "Status: Disconnected"
		statusText.TextColor3 = Color3.fromRGB(220, 50, 50)
		detailsText.Text = "Not connected to the Spoofer app. Ensure the desktop app is running."
		reconnectButton.Visible = true
		reconnectButton.Text = "Connect"
	end
end

local function request(endpoint, method, data)
	local ok, res = pcall(function()
		return httpService:RequestAsync({
			Url = SERVER_URL .. endpoint,
			Method = method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = (method ~= "GET" and data) and httpService:JSONEncode(data) or nil,
		})
	end)
	if not ok then return false, nil end
	local status = res.StatusCode or 0
	if status < 200 or status >= 300 then return false, nil end
	local dok, decoded = pcall(function() return httpService:JSONDecode(res.Body) end)
	return true, dok and decoded or res.Body
end

local function getCreatorInfo(info)
	local cType = info.Creator and string.sub(info.Creator.CreatorType or "User", 1, 1) or "U"
	local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "0")
	return cType, cId
end

local function getAnimationIds()
	local results, seen = {}, {}
	local descendants = game:GetDescendants()
	local total = #descendants
	request("/scan", "POST", { status = "scanning", progress = 0, results = {}, isStart = true })

	for i, obj in ipairs(descendants) do
		if i % 100 == 0 then
			task.wait()
			local progress = math.floor((i / total) * 100)
			request("/scan", "POST", { status = "scanning", progress = progress, results = results })
		end
		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and not seen[id] then
				local ok, info = pcall(function() return marketplace:GetProductInfo(tonumber(id)) end)
				if ok and info and info.AssetTypeId == 24 then
					local cType, cId = getCreatorInfo(info)
					table.insert(results, string.format("%s - %s - %s: %s", id, info.Name or "Unknown", cType, cId))
					seen[id] = true
					local progress = math.floor((i / total) * 100)
					request("/scan", "POST", { status = "scanning", progress = progress, results = results })
				end
			end
		elseif obj:IsA("LuaSourceContainer") then
			local sok, src = pcall(function() return obj.Source end)
			if sok and src and src ~= "" then
				for matchedId in src:gmatch("rbxassetid://(%d+)") do
					if not seen[matchedId] then
						local ok2, info2 = pcall(function() return marketplace:GetProductInfo(tonumber(matchedId)) end)
						if ok2 and info2 and info2.AssetTypeId == 24 then
							local cType, cId = getCreatorInfo(info2)
							table.insert(results, string.format("%s - %s - %s: %s", matchedId, info2.Name or "Unknown", cType, cId))
							seen[matchedId] = true
							local progress = math.floor((i / total) * 100)
							request("/scan", "POST", { status = "scanning", progress = progress, results = results })
						end
					end
				end
			end
		end
	end
	request("/scan", "POST", { status = "completed", progress = 100, results = results })
	return results
end

local function buildIdMap(mappings)
	local idMap = {}
	for line in mappings:gmatch("[^\r\n]+") do
		local oldId, newId = line:match("(%d+)%s*[=|]%s*(%d+)")
		if oldId and newId and oldId ~= newId then
			idMap[oldId] = newId
		end
	end
	return idMap
end

local function replaceIds(idMap)
	local count = 0
	local startTime = tick()

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
				if newSrc ~= src then
					obj.Source = newSrc
					count = count + 1
				end
			end
		end
	end

	local elapsed = tick() - startTime
	request("/replace-complete", "POST", { success = true, replacedCount = count, elapsed = elapsed })
	return count
end

local function connect()
	local ok = select(1, request("/ping", "GET"))
	if not ok then
		isConnected = false
		return false
	end

	local placeId = game.PlaceId or 0
	local placeName = "Unknown"
	local nameOk, info = pcall(function()
		return placeId > 0 and marketplace:GetProductInfo(placeId).Name or nil
	end)
	if nameOk and info then placeName = info end

	local cok = select(1, request("/connect", "POST", { placeId = placeId, placeName = placeName }))
	if cok then
		isConnected = true
		lastMappingsHash = nil
	else
		isConnected = false
	end
	return isConnected
end

local function poll()
	while isConnected do
		task.wait(2)
		local hasActivity = false

		local pok, _ = request("/ping", "GET")
		if not pok then
			isConnected = false
			updateUI()
			break
		end

		local sok, scanRes = request("/get-scan-request", "GET")
		if not sok then
			isConnected = false
			updateUI()
			break
		end
		if scanRes and scanRes.assetType == "Animation" then
			local results = getAnimationIds()
			if results and #results > 0 then
				local postOk = request("/scan", "POST", { assetType = "Animation", results = results, timestamp = os.time() })
				if not postOk then
					isConnected = false
					updateUI()
					break
				end
				hasActivity = true
			end
		end

		local mok, mapRes = request("/get-mappings", "GET")
		if not mok then
			isConnected = false
			updateUI()
			break
		end
		if mapRes and mapRes.mappings and #mapRes.mappings > 0 then
			local hash = table.concat(mapRes.mappings, "|")
			if hash ~= lastMappingsHash then
				lastMappingsHash = hash
				local idMap = buildIdMap(table.concat(mapRes.mappings, "\n"))
				if next(idMap) then
					local count = replaceIds(idMap)
					if count > 0 then
						local postOk = request("/replace-complete", "POST", { success = true, replacedCount = count })
						if not postOk then
							isConnected = false
							updateUI()
							break
						end
						hasActivity = true
					end
				end
			end
		end

		if not hasActivity then task.wait(8) end
	end
end

reconnectButton.MouseButton1Click:Connect(function()
	detailsText.Text = "Connecting..."
	isConnected = false
	updateUI()
	local ok = connect()
	updateUI()
	if ok then
		task.spawn(poll)
	else
		detailsText.Text = "Connection failed. Make sure the spoofer desktop app is open."
	end
end)

local toolbar = plugin:CreateToolbar("Jonuffy Spoofer")
local toggleButton = toolbar:CreateButton("Jonuffy Spoofer", "View Details", "rbxassetid://133573191144566")
toggleButton.Click:Connect(function()
	spooferWidget.Enabled = not spooferWidget.Enabled
end)

task.spawn(function()
	while true do
		if not isConnected then
			if connect() then
				updateUI()
				task.spawn(poll)
			else
				updateUI()
			end
		end
		task.wait(5)
	end
end)

updateUI()
