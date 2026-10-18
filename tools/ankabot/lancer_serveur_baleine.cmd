@echo off
rem Serveur de plans du Ventre de la Baleine (et recepteur du journal AnkaBot) pour BaleineCombat.lua.
rem FICHIER GENERE par tools/ventre-de-la-baleine/script.ts (chemin du projet ci-dessous).
rem A lancer AVANT de charger BaleineCombat.lua ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).
cd /d "C:\Users\Nouamane\Documents\DofusSimu"
call npx tsx tools/ventre-de-la-baleine/serveur.ts
pause
