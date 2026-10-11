function chooseChallenge(challengeId, i)
	global:delay(global:random(500, 1000))
	local ChallengeSelectionRequest = developer:createMessage("ChallengeSelectionRequest")
	ChallengeSelectionRequest.ChallengeId = challengeId
	developer:sendMessage(ChallengeSelectionRequest)
	global:printMessage("Le challenge ("..fightChallenge:challengeName(challengeId)..") a été choisi pour le slot N°"..tostring(i)..".")
	return challengeId
end
function challengeManagement(challengeCount, isMule)

	-------------------------------------------------------------------------------------------
	-------------------------------------------------------------------------------------------
	-------------------------------------------------------------------------------------------
	-- Liste des challenges à choisir par ordre de priorité
	-- La liste des identificants : https://www.ankabot.dev/Identifiants/DofusPC/Challenges.txt
	local challengesPriority = {
		1, -- Zombie
		2, -- Statue
		3, -- Premier
		4, -- Dernier
		5, -- Économe
		6, -- Versatile
		7, -- Jardinier
		8, -- Nomade
		9, -- Barbare
	}

	-- Choix le type de bonus
	-- 0 = XP
	-- 1 = DROP
	local challengeBonus = 1

	-- Choix du mode des challenges
	-- 0 = Manuel
	-- 1 = Aléatoire
	local challengeMod = 0
	-------------------------------------------------------------------------------------------
	-------------------------------------------------------------------------------------------
	-------------------------------------------------------------------------------------------

	-- Texte variables
	local challengeBonusText = { "XP", "DROP" }
	local challengeModText = { "Manuel", "Aléatoire" }

	-- Choix le type de bonus
	local ChallengeBonusChoiceRequest = developer:createMessage("ChallengeBonusChoiceRequest")
	ChallengeBonusChoiceRequest.ChallengeBonus = challengeBonus
	developer:sendMessage(ChallengeBonusChoiceRequest)

	-- Message
	if not isMule then
		global:printSuccess("Challenges: "..challengeModText[challengeMod + 1].." - Bonus: "..challengeBonusText[challengeBonus + 1])
	else
		global:printSuccess("[MULE] Bonus: "..challengeBonusText[challengeBonus + 1])
		return
	end

	-- Choix du mode des challenges
	local ChallengeModSelectRequest = developer:createMessage("ChallengeModSelectRequest")
	ChallengeModSelectRequest.ChallengeMod = challengeMod
	developer:sendMessage(ChallengeModSelectRequest)

	-- Gestion des challenges
	if challengeMod == 0 then

		-- Attente aléatoire
		global:printMessage("Attente aléatoire avant ...")
		global:delay(global:random(1000, 2000))

		-- Passer au étape des choix des challenges
		global:printMessage("Passage à l'étape du choix des challenges ...")
		local ChallengeReadyRequest = developer:createMessage("ChallengeReadyRequest")
		ChallengeReadyRequest.ChallengeMod = challengeMod
		developer:sendMessage(ChallengeReadyRequest)

		-- Chaque slot de challenge
		for i = 1, challengeCount do
			local state = developer:suspendScriptUntil("ChallengeProposalEvent", "", false, 5000, true, 50)
			if state == false then
				return
			end

			-- Récupérer les challenges proposés pour ce slot
			local proposedChallenges = fightChallenge:getLastChallengeProposalMessage()

			-- Afficher les challenges proposés
			global:printMessage("Liste des challenges proposés pour le slot N°"..tostring(i)..":")
			for index, proposedChallenge in ipairs(proposedChallenges.ChallengeProposals) do
				if index > 2 then
					break
				end
				global:printMessage("         Challenge: "..fightChallenge:challengeName(proposedChallenge.ChallengeId).." - Bonus XP: "..tostring(proposedChallenge.XpBonus).."% - Bonus DROP: "..tostring(proposedChallenge.DropBonus).."%")
			end

			-- Choisir par défaut le premier challenge
			local choosedChallengeId = chooseChallenge(proposedChallenges.ChallengeProposals[1].ChallengeId, i)

			-- Rechoisir un challenge selon sa priorité et sa disponibilité dans la liste
			local found = false
			for _, challengePriority in ipairs(challengesPriority) do
				for index, proposedChallenge in ipairs(proposedChallenges.ChallengeProposals) do
					if index > 2 then
						break
					end
					if proposedChallenge.ChallengeId == challengePriority then
						if index > 1 then
							choosedChallengeId = chooseChallenge(proposedChallenge.ChallengeId, i)
						end
						found = true
						break
					end
				end
				if found then
					break
				end
			end

			-- Valider
			global:printMessage("Validation ...")
			global:delay(global:random(500, 1000))
			local ChallengeValidateRequest = developer:createMessage("ChallengeValidateRequest")
			ChallengeValidateRequest.ChallengeId = choosedChallengeId
			developer:sendMessage(ChallengeValidateRequest)
		end

		-- Attente aléatoire
		global:printMessage("Attente aléatoire après ...")
		global:delay(global:random(1000, 2000))
	end
end