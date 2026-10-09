#!/bin/bash
cd tools/reine-des-voleurs/v2/search
k=$1
n=0
while read g S T Y; do
  n=$((n+1))
  if [ $((n % 4)) -ne $k ]; then continue; fi
  if [ "$Y" = "-" ]; then npx tsx finale.ts $S $T 0,1,2,3 A/next > rob/$g-$T.txt 2>&1; else npx tsx finale.ts $S $T 0,1,2,3 A/next $Y > rob/$g-$T.txt 2>&1; fi
done < rob/liste.txt
echo fini > rob/fini-$k
