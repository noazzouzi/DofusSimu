@echo off
rem Serveur de plans du Sacrieur (Taniere du Meulou) et recepteur du journal AnkaBot, pour MeulouCombat.lua et MeulouMain.lua.
rem FICHIER GENERE par tools/meulou/script.ts (chemin du projet ci-dessous).
rem A lancer AVANT de charger le script ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).
rem Planificateur modifie : relancer ce serveur.
cd /d "C:\Users\Nouamane\Documents\DofusSimu"
set FIGHTLOG_PORT=8767
call npx tsx tools/meulou/serveur.ts
pause
