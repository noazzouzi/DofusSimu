@echo off
rem Recepteur du journal de combats AnkaBot (journal-combats.lua) : ecrit data/fightlogs/<date>/session-<heure>.jsonl.
rem A lancer AVANT de charger journal-combats.lua sur le chef ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).
rem Apres un combat : node scripts/fightlog-check.mjs (bilan du journal), npm run baleine:bilan (Ventre de la Baleine).
cd /d "%~dp0..\.."
node scripts/fightlog-server.mjs
pause
