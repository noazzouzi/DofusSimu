@echo off
rem Serveur de plans de la Reine des Voleurs (et recepteur du journal AnkaBot) pour ReineCombat.lua.
rem FICHIER GENERE par tools/fightlog/combat.ts (chemin du projet ci-dessous).
rem A lancer AVANT de charger ReineCombat.lua ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).
cd /d "C:\Users\Nouamane\Documents\DofusSimu"
call npx tsx tools/reine-des-voleurs/planificateur/serveur.ts
pause
