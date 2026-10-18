@echo off
rem Serveur de plans du Feca contre les Krobes (et recepteur du journal AnkaBot) pour FecaCombat.lua.
rem FICHIER GENERE par tools/feca/script.ts (chemin du projet ci-dessous).
rem A lancer AVANT de charger FecaCombat.lua ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).
cd /d "C:\Users\Nouamane\Documents\DofusSimu"
set FIGHTLOG_PORT=8766
call npx tsx tools/feca/serveur.ts
pause
