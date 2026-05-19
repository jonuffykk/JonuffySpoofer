return function(parent)
	parent = parent or game:GetService("CoreGui")

	local ui = Instance.new("ScreenGui")
	ui.Name = "JonuffySpoofer"
	ui.ResetOnSpawn = false
	ui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	ui.IgnoreGuiInset = true
	ui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets
	ui.Parent = parent

	local dim = Instance.new("Frame")
	dim.Name = "DimBackground"
	dim.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	dim.BackgroundTransparency = 0.5
	dim.BorderSizePixel = 0
	dim.Size = UDim2.new(1, 0, 1, 0)
	dim.Parent = ui

	local popup = Instance.new("Frame")
	popup.Name = "MainPopup"
	popup.AnchorPoint = Vector2.new(0.5, 0.5)
	popup.BackgroundColor3 = Color3.fromRGB(249, 250, 251)
	popup.BorderSizePixel = 0
	popup.ClipsDescendants = true
	popup.Position = UDim2.new(0.5, 0, 0.5, 0)
	popup.Size = UDim2.new(0, 0, 0, 0)
	popup.AutomaticSize = Enum.AutomaticSize.None
	popup.Parent = ui

	do
		local sc = Instance.new("UISizeConstraint")
		sc.MinSize = Vector2.new(380, 460)
		sc.MaxSize = Vector2.new(580, 520)
		sc.Parent = popup

		local ar = Instance.new("UIAspectRatioConstraint")
		ar.AspectRatio = 1.18
		ar.Parent = popup

		local scale = Instance.new("UIScale")
		scale.Name = "AutoScale"
		scale.Parent = popup

		local stroke = Instance.new("UIStroke")
		stroke.Color = Color3.fromRGB(229, 231, 235)
		stroke.Transparency = 0
		stroke.Thickness = 1
		stroke.Parent = popup
	end

	local topBar = Instance.new("Frame")
	topBar.Name = "TopBar"
	topBar.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	topBar.BorderSizePixel = 0
	topBar.Size = UDim2.new(1, 0, 0, 68)
	topBar.Parent = popup

	do
		local sep = Instance.new("Frame")
		sep.Name = "Separator"
		sep.BackgroundColor3 = Color3.fromRGB(229, 231, 235)
		sep.BorderSizePixel = 0
		sep.Position = UDim2.new(0, 0, 1, -1)
		sep.Size = UDim2.new(1, 0, 0, 1)
		sep.Parent = topBar

		local icon = Instance.new("ImageLabel")
		icon.Name = "Icon"
		icon.BackgroundTransparency = 1
		icon.BorderSizePixel = 0
		icon.Position = UDim2.new(0, 16, 0, 16)
		icon.Size = UDim2.new(0, 46, 0, 46)
		icon.Image = "rbxassetid://133573191144566"
		icon.ScaleType = Enum.ScaleType.Crop
		icon.Parent = topBar

		local title = Instance.new("TextLabel")
		title.Name = "Title"
		title.BackgroundTransparency = 1
		title.Position = UDim2.new(0, 74, 0, 11)
		title.Size = UDim2.new(0, 280, 0, 24)
		title.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)
		title.Text = "Jonuffy Spoofer"
		title.TextColor3 = Color3.fromRGB(17, 24, 39)
		title.TextSize = 17
		title.TextXAlignment = Enum.TextXAlignment.Left
		title.Parent = topBar

		local sub = Instance.new("TextLabel")
		sub.Name = "Subtitle"
		sub.BackgroundTransparency = 1
		sub.Position = UDim2.new(0, 74, 0, 36)
		sub.Size = UDim2.new(0, 280, 0, 18)
		sub.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
		sub.Text = "Scan · Replace · Output"
		sub.TextColor3 = Color3.fromRGB(107, 114, 128)
		sub.TextSize = 12
		sub.TextXAlignment = Enum.TextXAlignment.Left
		sub.Parent = topBar

		local closeBtn = Instance.new("TextButton")
		closeBtn.Name = "CloseButton"
		closeBtn.AnchorPoint = Vector2.new(1, 0)
		closeBtn.BackgroundTransparency = 1
		closeBtn.Position = UDim2.new(1, -14, 0, 14)
		closeBtn.Size = UDim2.new(0, 36, 0, 36)
		closeBtn.AutoButtonColor = false
		closeBtn.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
		closeBtn.Text = "×"
		closeBtn.TextColor3 = Color3.fromRGB(156, 163, 175)
		closeBtn.TextSize = 28
		closeBtn.Parent = topBar

	end

	local tabBar = Instance.new("Frame")
	tabBar.Name = "TabBar"
	tabBar.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	tabBar.BorderSizePixel = 0
	tabBar.Position = UDim2.new(0, 0, 0, 68)
	tabBar.Size = UDim2.new(1, 0, 0, 46)
	tabBar.Parent = popup

	do
		local layout = Instance.new("UIListLayout")
		layout.FillDirection = Enum.FillDirection.Horizontal
		layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
		layout.VerticalAlignment = Enum.VerticalAlignment.Center
		layout.Padding = UDim.new(0, 8)
		layout.Parent = tabBar

		local function makeTab(name, label, active)
			local btn = Instance.new("TextButton")
			btn.Name = name .. "Tab"
			btn.BackgroundColor3 = active and Color3.fromRGB(59, 91, 219) or Color3.fromRGB(243, 244, 246)
			btn.BackgroundTransparency = 0
			btn.BorderSizePixel = 0
			btn.Size = UDim2.new(0, 140, 0, 36)
			btn.AutoButtonColor = false
			btn.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.SemiBold, Enum.FontStyle.Normal)
			btn.Text = label
			btn.TextColor3 = active and Color3.fromRGB(255, 255, 255) or Color3.fromRGB(107, 114, 128)
			btn.TextSize = 14
			btn.Parent = tabBar
			return btn
		end

		makeTab("Scan", "Scan IDs", true)
		makeTab("Replace", "Replace IDs", false)
	end

	local scanPage = Instance.new("Frame")
	scanPage.Name = "ScanPage"
	scanPage.BackgroundTransparency = 1
	scanPage.BorderSizePixel = 0
	scanPage.Position = UDim2.new(0, 0, 0, 114)
	scanPage.Size = UDim2.new(1, 0, 1, -114)
	scanPage.ClipsDescendants = true
	scanPage.Parent = popup

	do
		local pad = Instance.new("UIPadding")
		pad.PaddingLeft = UDim.new(0, 18)
		pad.PaddingRight = UDim.new(0, 18)
		pad.PaddingTop = UDim.new(0, 18)
		pad.PaddingBottom = UDim.new(0, 18)
		pad.Parent = scanPage

		local prompt = Instance.new("TextLabel")
		prompt.Name = "Prompt"
		prompt.BackgroundTransparency = 1
		prompt.Size = UDim2.new(1, 0, 0, 20)
		prompt.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
		prompt.Text = "Choose what to scan from your game."
		prompt.TextColor3 = Color3.fromRGB(107, 114, 128)
		prompt.TextSize = 14
		prompt.TextXAlignment = Enum.TextXAlignment.Left
		prompt.Parent = scanPage

		local animBtn = Instance.new("TextButton")
		animBtn.Name = "AnimationsButton"
		animBtn.BackgroundColor3 = Color3.fromRGB(59, 91, 219)
		animBtn.BorderSizePixel = 0
		animBtn.Position = UDim2.new(0, 0, 0, 34)
		animBtn.Size = UDim2.new(1, 0, 0, 56)
		animBtn.AutoButtonColor = false
		animBtn.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.SemiBold, Enum.FontStyle.Normal)
		animBtn.Text = "Scan Animations"
		animBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		animBtn.TextSize = 16
		animBtn.Parent = scanPage

		local sndBtn = Instance.new("TextButton")
		sndBtn.Name = "SoundButton"
		sndBtn.BackgroundColor3 = Color3.fromRGB(47, 158, 68)
		sndBtn.BorderSizePixel = 0
		sndBtn.Position = UDim2.new(0, 0, 0, 106)
		sndBtn.Size = UDim2.new(1, 0, 0, 56)
		sndBtn.AutoButtonColor = false
		sndBtn.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.SemiBold, Enum.FontStyle.Normal)
		sndBtn.Text = "Scan Sounds"
		sndBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		sndBtn.TextSize = 16
		sndBtn.Parent = scanPage
	end

	local replacePage = Instance.new("Frame")
	replacePage.Name = "ReplacePage"
	replacePage.BackgroundTransparency = 1
	replacePage.BorderSizePixel = 0
	replacePage.Position = UDim2.new(0, 0, 0, 114)
	replacePage.Size = UDim2.new(1, 0, 1, -114)
	replacePage.ClipsDescendants = true
	replacePage.Visible = false
	replacePage.Parent = popup

	do
		local pad = Instance.new("UIPadding")
		pad.PaddingLeft = UDim.new(0, 18)
		pad.PaddingRight = UDim.new(0, 18)
		pad.PaddingTop = UDim.new(0, 18)
		pad.PaddingBottom = UDim.new(0, 18)
		pad.Parent = replacePage

		local hint = Instance.new("TextLabel")
		hint.Name = "Hint"
		hint.BackgroundTransparency = 1
		hint.Size = UDim2.new(1, 0, 0, 20)
		hint.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
		hint.Text = "Paste mapped IDs below (one per line: oldId = newId)"
		hint.TextColor3 = Color3.fromRGB(107, 114, 128)
		hint.TextSize = 14
		hint.TextXAlignment = Enum.TextXAlignment.Left
		hint.Parent = replacePage

		local inputBox = Instance.new("TextBox")
		inputBox.Name = "MappedIdsInput"
		inputBox.BackgroundColor3 = Color3.fromRGB(242, 243, 244)
		inputBox.BorderSizePixel = 0
		inputBox.Position = UDim2.new(0, 0, 0, 30)
		inputBox.Size = UDim2.new(1, 0, 0, 110)
		inputBox.ClearTextOnFocus = false
		inputBox.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)
		inputBox.MultiLine = true
		inputBox.PlaceholderColor3 = Color3.fromRGB(156, 163, 175)
		inputBox.PlaceholderText = "123456=789012\n111111=222222"
		inputBox.Text = ""
		inputBox.TextColor3 = Color3.fromRGB(17, 24, 39)
		inputBox.TextSize = 14
		inputBox.TextWrapped = false
		inputBox.TextXAlignment = Enum.TextXAlignment.Left
		inputBox.TextYAlignment = Enum.TextYAlignment.Top
		inputBox.Parent = replacePage

		local ibp = Instance.new("UIPadding")
		ibp.PaddingTop = UDim.new(0, 10)
		ibp.PaddingLeft = UDim.new(0, 12)
		ibp.PaddingRight = UDim.new(0, 12)
		ibp.PaddingBottom = UDim.new(0, 10)
		ibp.Parent = inputBox

		local runBtn = Instance.new("TextButton")
		runBtn.Name = "RunButton"
		runBtn.BackgroundColor3 = Color3.fromRGB(59, 91, 219)
		runBtn.BorderSizePixel = 0
		runBtn.Position = UDim2.new(0, 0, 0, 145)
		runBtn.Size = UDim2.new(1, 0, 0, 35)
		runBtn.AutoButtonColor = false
		runBtn.FontFace = Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.SemiBold, Enum.FontStyle.Normal)
		runBtn.Text = "Run Replacement"
		runBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		runBtn.TextSize = 15
		runBtn.Parent = replacePage
	end

	return ui
end
