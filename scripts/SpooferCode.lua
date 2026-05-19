local pluginEnvironment = script.Parent
local assets = pluginEnvironment.Assets
local coreGui = game:GetService("CoreGui")
local tweenService = game:GetService("TweenService")
local marketplace = game:GetService("MarketplaceService")
local serverStorage = game:GetService("ServerStorage")
local scriptEditorService = game:GetService("ScriptEditorService")
local studioUserId = plugin:GetStudioUserId()

local createSpooferUI = require(assets.SpooferUI)

local spooferUi = nil
local isProcessing = false
local isReplacing = false
local connections = {}

local BRAND = Color3.fromRGB(59, 91, 219)
local TEXT_MUTED = Color3.fromRGB(148, 163, 184)
local TEXT_SUBTLE = Color3.fromRGB(100, 116, 139)
local WHITE = Color3.fromRGB(255, 255, 255)
local SURFACE = Color3.fromRGB(245, 246, 248)

local function disconnectAll()
	for _, c in ipairs(connections) do
		if c and c.Disconnect then c:Disconnect() end
	end
	table.clear(connections)
end

local function conn(signal, fn)
	table.insert(connections, signal:Connect(fn))
end

local function getOrCreateScale(instance)
	return instance:FindFirstChildOfClass("UIScale") or (function()
		local s = Instance.new("UIScale")
		s.Parent = instance
		return s
	end)()
end

local function tween(instance, info, props)
	local t = tweenService:Create(instance, info, props)
	t:Play()
	return t
end

local FAST = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
local MED = TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

local function animateOpen(ui)
	local popup = ui:FindFirstChild("MainPopup")
	local dim = ui:FindFirstChild("DimBackground")
	if not popup then return end
	local scale = getOrCreateScale(popup)
	scale.Scale = 0.85
	popup.Position = UDim2.new(0.5, 0, 0.52, 0)
	if dim then
		dim.BackgroundTransparency = 1
		tween(dim, MED, { BackgroundTransparency = 0.45 })
	end
	tween(scale, TweenInfo.new(0.2, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 })
	tween(popup, MED, { Position = UDim2.new(0.5, 0, 0.5, 0) })
end

local function animateClose(ui, afterClose)
	local popup = ui:FindFirstChild("MainPopup")
	local dim = ui:FindFirstChild("DimBackground")
	if not popup then
		if afterClose then afterClose() end
		return
	end
	local scale = getOrCreateScale(popup)
	if dim then
		tween(dim, FAST, { BackgroundTransparency = 1 })
	end
	local ct = tween(scale, FAST, { Scale = 0.85 })
	tween(popup, FAST, { Position = UDim2.new(0.5, 0, 0.52, 0) })
	ct.Completed:Once(function()
		if afterClose then afterClose() end
	end)
end

local function attachButtonAnim(button, holder)
	local target = holder or button
	local scale = getOrCreateScale(target)
	conn(button.MouseEnter, function()
		tween(scale, FAST, { Scale = 1.03 })
	end)
	conn(button.MouseLeave, function()
		tween(scale, FAST, { Scale = 1 })
	end)
	conn(button.MouseButton1Down, function()
		tween(scale, TweenInfo.new(0.07, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Scale = 0.97 })
	end)
	conn(button.MouseButton1Up, function()
		tween(scale, FAST, { Scale = 1.03 })
	end)
end

local function attachCloseAnim(button)
	conn(button.MouseEnter, function()
		tween(button, FAST, { BackgroundColor3 = Color3.fromRGB(235, 237, 242) })
	end)
	conn(button.MouseLeave, function()
		tween(button, FAST, { BackgroundColor3 = SURFACE })
	end)
end

local function isOwnedByCurrentUser(info)
	if not info or not info.Creator then return false end
	if info.Creator.CreatorType == "User" then
		return info.Creator.CreatorTargetId == studioUserId
	end
	return false
end

local function extractAssetIds(source)
	local ids = {}
	for id in source:gmatch("rbxassetid://(%d+)") do ids[id] = true end
	return ids
end

local function getAnimationIds(onProgress)
	local results, seen = {}, {}
	for i, obj in ipairs(game:GetDescendants()) do
		if i % 50 == 0 then task.wait() end
		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and not seen[id] then
				local ok, info = pcall(function() return marketplace:GetProductInfo(tonumber(id)) end)
				if ok and info and info.AssetTypeId == 24 then
					local cType = string.sub(info.Creator and info.Creator.CreatorType or "User", 1, 1)
					local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown")
					table.insert(results, string.format("%s - %s - %s: %s", id, info.Name or "Unknown", cType, cId))
					seen[id] = true
					if onProgress then onProgress(#results) end
				end
			end
		end
		if obj:IsA("LuaSourceContainer") then
			local ok, src = pcall(function() return obj.Source end)
			if ok and src and src ~= "" then
				for matchedId in pairs(extractAssetIds(src)) do
					if not seen[matchedId] then
						local ok2, info = pcall(function() return marketplace:GetProductInfo(tonumber(matchedId)) end)
						if ok2 and info and info.AssetTypeId == 24 then
							local cType = string.sub(info.Creator and info.Creator.CreatorType or "User", 1, 1)
							local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown")
							table.insert(results, string.format("%s - %s - %s: %s", matchedId, info.Name or "Unknown", cType, cId))
							seen[matchedId] = true
							if onProgress then onProgress(#results) end
						end
					end
				end
			end
		end
	end
	return results
end

local function getSoundIds(onProgress)
	local results, seen = {}, {}
	for i, obj in ipairs(game:GetDescendants()) do
		if i % 50 == 0 then task.wait() end
		local added = false
		if obj:IsA("Sound") then
			local id = obj.SoundId:match("rbxassetid://(%d+)")
			if id and not seen[id] then
				local ok, info = pcall(function() return marketplace:GetProductInfo(tonumber(id)) end)
				if ok and info and info.AssetTypeId == 3 and not isOwnedByCurrentUser(info) then
					local cType = string.sub(info.Creator and info.Creator.CreatorType or "User", 1, 1)
					local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown")
					table.insert(results, string.format("%s - %s - %s: %s", id, info.Name or "Unknown", cType, cId))
					seen[id] = true
					added = true
				end
			end
		end
		if obj:IsA("LuaSourceContainer") then
			local ok, src = pcall(function() return obj.Source end)
			if ok and src and src ~= "" then
				for matchedId in pairs(extractAssetIds(src)) do
					if not seen[matchedId] then
						local ok2, info = pcall(function() return marketplace:GetProductInfo(tonumber(matchedId)) end)
						if ok2 and info and info.AssetTypeId == 3 and not isOwnedByCurrentUser(info) then
							local cType = string.sub(info.Creator and info.Creator.CreatorType or "User", 1, 1)
							local cId = tostring(info.Creator and (info.Creator.CreatorTargetId or info.Creator.Id) or "Unknown")
							table.insert(results, string.format("%s - %s - %s: %s", matchedId, info.Name or "Unknown", cType, cId))
							seen[matchedId] = true
							added = true
						end
					end
				end
			end
		end
		if added and onProgress then onProgress(#results) end
	end
	return results
end

local function replaceIds(inputString, onProgress)
	local idMap = {}
	for line in inputString:gmatch("[^\r\n]+") do
		local oldId, newId = line:match("(%d+)%s*[=|]%s*(%d+)")
		if oldId and newId and oldId ~= newId then
			idMap[oldId] = newId
		end
	end
	if next(idMap) == nil then
		warn("No valid ID mappings found. Format: oldId = newId")
		return
	end
	local assetType
	for oldId, newId in pairs(idMap) do
		pcall(function()
			local info = marketplace:GetProductInfo(tonumber(newId))
			if info then assetType = info.AssetTypeId end
		end)
		if assetType then break end
	end
	if not assetType then
		warn("Could not determine asset type.")
		return
	end
	local skipped = {}
	local descendants = game:GetDescendants()
	local total = #descendants
	for i, obj in ipairs(descendants) do
		if i % 50 == 0 then
			if onProgress then onProgress(i, total) end
			task.wait()
		end
		if assetType == 24 and obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and idMap[id] then obj.AnimationId = "rbxassetid://" .. idMap[id] end
		elseif assetType == 3 and obj:IsA("Sound") then
			local id = obj.SoundId:match("rbxassetid://(%d+)")
			if id and idMap[id] then obj.SoundId = "rbxassetid://" .. idMap[id] end
		end
		if obj:IsA("LuaSourceContainer") then
			local ok, src = pcall(function() return obj.Source end)
			if ok and src and src ~= "" then
				local newSrc, changed = src, false
				for oldId, newId in pairs(idMap) do
					local pat = "rbxassetid://%s*" .. oldId
					if newSrc:find(pat) then
						newSrc = newSrc:gsub(pat, "rbxassetid://" .. newId)
						changed = true
					end
				end
				if changed then
					local ok2, err = pcall(function()
						scriptEditorService:UpdateSourceAsync(obj, function() return newSrc end)
					end)
					if not ok2 then
						table.insert(skipped, obj:GetFullName() .. " -> " .. tostring(err))
					end
				end
			end
		end
	end
	if onProgress then onProgress(total, total) end
	if #skipped > 0 then
		warn("Skipped scripts:\n" .. table.concat(skipped, "\n"))
	else
		print("All replacements completed.")
	end
end

local function writeOutputScript(prefix, resultText)
	local folder = serverStorage:FindFirstChild("JonuffyExport") or Instance.new("Folder")
	folder.Name = "JonuffyExport"
	folder.Parent = serverStorage
	local scriptOut = Instance.new("Script")
	local timestamp = string.format("%d%02d%02d_%02d%02d%02d", os.date("%Y"), os.date("%m"), os.date("%d"), os.date("%H"), os.date("%M"), os.date("%S"))
	scriptOut.Name = "Export_" .. prefix .. "_" .. timestamp
	scriptOut.Disabled = true
	scriptOut.Source = "--[[\n\n" .. resultText .. "\n\n]]--\n\n-- Jonuffy Spoofer Export Data\n-- Paste this content into the desktop application"
	scriptOut.Parent = folder
	local children = folder:GetChildren()
	table.sort(children, function(a, b) return a.Name > b.Name end)
	for i = 8, #children do children[i]:Destroy() end
	plugin:OpenScript(scriptOut)
end

local function setTabActive(popup, tabName)
	local tabBar = popup:FindFirstChild("TabBar")
	local scanPage = popup:FindFirstChild("ScanPage")
	local replacePage = popup:FindFirstChild("ReplacePage")
	if not tabBar or not scanPage or not replacePage then
		warn("Missing UI elements for tab switching")
		return
	end

	local tabScan = tabBar:FindFirstChild("ScanTab")
	local tabReplace = tabBar:FindFirstChild("ReplaceTab")
	local isScan = tabName == "scan"

	scanPage.Visible = isScan
	replacePage.Visible = not isScan

	if tabScan then
		tabScan.BackgroundColor3 = isScan and Color3.fromRGB(59, 91, 219) or Color3.fromRGB(243, 244, 246)
		tabScan.TextColor3 = isScan and Color3.fromRGB(255, 255, 255) or Color3.fromRGB(107, 114, 128)
	end
	if tabReplace then
		tabReplace.BackgroundColor3 = (not isScan) and Color3.fromRGB(59, 91, 219) or Color3.fromRGB(243, 244, 246)
		tabReplace.TextColor3 = (not isScan) and Color3.fromRGB(255, 255, 255) or Color3.fromRGB(107, 114, 128)
	end
end

local function setupUI(ui)
	disconnectAll()

	local popup = ui:FindFirstChild("MainPopup")
	if not popup then
		warn("MainPopup not found in UI")
		return
	end

	local topBar = popup:FindFirstChild("TopBar")
	if not topBar then
		warn("TopBar not found in MainPopup")
		return
	end

	local closeBtn = topBar:FindFirstChild("CloseButton")
	local tabBar = popup:FindFirstChild("TabBar")
	local tabScan = tabBar and tabBar:FindFirstChild("ScanTab")
	local tabReplace = tabBar and tabBar:FindFirstChild("ReplaceTab")
	local scanPage = popup:FindFirstChild("ScanPage")
	local replacePage = popup:FindFirstChild("ReplacePage")

	if not closeBtn or not tabBar or not tabScan or not tabReplace or not scanPage or not replacePage then
		warn("Missing required UI elements")
		return
	end

	local promptLabel = scanPage:FindFirstChild("Prompt")
	local animBtn = scanPage:FindFirstChild("AnimationsButton")
	local soundBtn = scanPage:FindFirstChild("SoundButton")
	local inputBox = replacePage:FindFirstChild("MappedIdsInput")
	local runBtn = replacePage:FindFirstChild("RunButton")

	if not promptLabel or not animBtn or not soundBtn or not inputBox or not runBtn then
		warn("Missing some UI elements in panels")
		return
	end

	attachCloseAnim(closeBtn)
	attachButtonAnim(animBtn, animBtn)
	attachButtonAnim(soundBtn, soundBtn)
	attachButtonAnim(runBtn, runBtn)

	setTabActive(popup, "scan")

	conn(tabScan.MouseButton1Click, function()
		setTabActive(popup, "scan")
	end)
	conn(tabReplace.MouseButton1Click, function()
		setTabActive(popup, "replace")
	end)

	local function setGetEnabled(enabled)
		animBtn.Active = enabled
		soundBtn.Active = enabled
	end

	conn(animBtn.MouseButton1Click, function()
		if isProcessing then return end
		isProcessing = true
		setGetEnabled(false)
		promptLabel.Text = "Scanning animations..."
		task.spawn(function()
			local results = getAnimationIds(function(count)
				promptLabel.Text = "Found " .. count .. " animation(s)..."
			end)
			writeOutputScript("Animations", table.concat(results, "\n"))
			promptLabel.Text = "Done — " .. #results .. " animation(s) found"
			isProcessing = false
			setGetEnabled(true)
		end)
	end)

	conn(soundBtn.MouseButton1Click, function()
		if isProcessing then return end
		isProcessing = true
		setGetEnabled(false)
		promptLabel.Text = "Scanning sounds..."
		task.spawn(function()
			local results = getSoundIds(function(count)
				promptLabel.Text = "Found " .. count .. " sound(s)..."
			end)
			writeOutputScript("Sounds", table.concat(results, "\n"))
			promptLabel.Text = "Done — " .. #results .. " sound(s) found"
			isProcessing = false
			setGetEnabled(true)
		end)
	end)

	conn(runBtn.MouseButton1Click, function()
		if isReplacing then return end
		local text = inputBox.Text
		if not text or #text <= 5 then
			warn("Input is empty or too short.")
			return
		end
		isReplacing = true
		local currentPct = 0
		local running = true
		task.spawn(function()
			local dots = { ".", "..", "..." }
			local f = 1
			while running do
				runBtn.Text = "Replacing" .. dots[f] .. " " .. currentPct .. "%"
				f = f % 3 + 1
				task.wait(0.4)
			end
		end)
		task.spawn(function()
			replaceIds(text, function(processed, total)
				currentPct = math.floor((processed / total) * 100)
			end)
			running = false
			isReplacing = false
			runBtn.Text = "Run Replacement"
		end)
	end)

	conn(closeBtn.MouseButton1Click, function()
		animateClose(ui, function()
			ui.Enabled = false
			isProcessing = false
			isReplacing = false
			promptLabel.Text = "Choose what to scan from your game."
			runBtn.Text = "Run Replacement"
		end)
	end)
end

local toolbar = plugin:CreateToolbar("Jonuffy Spoofer")
local spooferButton = toolbar:CreateButton(
	"Spoofer",
	"Open Jonuffy Spoofer — scan and replace Animation/Sound IDs",
	"rbxassetid://133573191144566"
)
spooferButton.ClickableWhenViewportHidden = true

spooferButton.Click:Connect(function()
	if spooferUi and spooferUi.Parent and spooferUi.Enabled then
		animateClose(spooferUi, function()
			spooferUi.Enabled = false
		end)
		return
	end
	if spooferUi and spooferUi.Parent then
		spooferUi.Enabled = true
		animateOpen(spooferUi)
		return
	end
	spooferUi = createSpooferUI(coreGui)
	spooferUi.Enabled = true
	setupUI(spooferUi)
	animateOpen(spooferUi)
end)
