#!/bin/bash
cd tools/reine-des-voleurs/v2/search
k=$1
npx tsx transition.ts selection-transition.json 400 $k 4 > trans-$k.txt 2>/dev/null
npx tsx transition.ts reste-pm5.json 20000 $k 4 > trans2-$k.txt 2> trans2-$k.err
echo fini > trans-fini-$k
