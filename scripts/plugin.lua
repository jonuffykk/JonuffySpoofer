local httpService = game:GetService("HttpService")
local marketplace = game:GetService("MarketplaceService")

local SERVER_URL = "http://127.0.0.1:28476"
local isConnected = false
local lastMappingsHash = nil

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
	for i, obj in ipairs(descendants) do
		if i % 100 == 0 then task.wait() end
		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and not seen[id] then
				local ok, info = pcall(function() return marketplace:GetProductInfo(tonumber(id)) end)
				if ok and info and info.AssetTypeId == 24 then
					local cType, cId = getCreatorInfo(info)
					table.insert(results, string.format("%s - %s - %s: %s", id, info.Name or "Unknown", cType, cId))
					seen[id] = true
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
						end
					end
				end
			end
		end
	end
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
	for i, obj in ipairs(game:GetDescendants()) do
		if i % 100 == 0 then task.wait() end
		local replaced = false

		if obj:IsA("Animation") then
			local id = obj.AnimationId:match("rbxassetid://(%d+)")
			if id and idMap[id] then
				obj.AnimationId = "rbxassetid://" .. idMap[id]
				replaced = true
			end
		end

		if obj:IsA("LuaSourceContainer") then
			local ok, src = pcall(function() return obj.Source end)
			if ok and src then
				local newSrc = src
				for oldId, newId in pairs(idMap) do
					newSrc = newSrc:gsub("rbxassetid://" .. oldId, "rbxassetid://" .. newId)
				end
				if newSrc ~= src then
					obj.Source = newSrc
					replaced = true
				end
			end
		end

		if replaced then count += 1 end
	end
	return count
end

local function connect()
	local ok = select(1, request("/ping", "GET"))
	if not ok then return false end

	local placeId = game.PlaceId or 0
	local placeName = "Unknown"
	local nameOk, info = pcall(function()
		return placeId > 0 and marketplace:GetProductInfo(placeId).Name or nil
	end)
	if nameOk and info then placeName = info end

	local cok = select(1, request("/connect", "POST", { placeId = placeId, placeName = placeName }))
	if cok then isConnected = true end
	return cok
end

local function poll()
	while isConnected do
		task.wait(2)
		local hasActivity = false

		local sok, scanRes = request("/get-scan-request", "GET")
		if sok and scanRes and scanRes.assetType == "Animation" then
			local results = getAnimationIds()
			if results and #results > 0 then
				request("/scan", "POST", { assetType = "Animation", results = results, timestamp = os.time() })
				hasActivity = true
			end
		end

		local mok, mapRes = request("/get-mappings", "GET")
		if mok and mapRes and mapRes.mappings and #mapRes.mappings > 0 then
			local hash = table.concat(mapRes.mappings, "|")
			if hash ~= lastMappingsHash then
				lastMappingsHash = hash
				local idMap = buildIdMap(table.concat(mapRes.mappings, "\n"))
				if next(idMap) then
					local count = replaceIds(idMap)
					if count > 0 then
						request("/replace-complete", "POST", { success = true, replacedCount = count })
						hasActivity = true
					end
				end
			end
		end

		if not hasActivity then task.wait(8) end
	end
end

task.spawn(function()
	while true do
		if not isConnected and connect() then
			task.spawn(poll)
		end
		task.wait(5)
	end
end)
