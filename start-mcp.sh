#!/bin/bash
export GRAPHSTORE_BACKEND=kuzu
export GRAPHSTORE_ON_DEMAND=true
export GRAPHSTORE_READONLY=true
export KUZU_DB_PATH=/Users/anagnole/Projects/ThesisBrainifai/.brainifai/data/kuzu
export BRAINIFAI_INSTANCE_PATH=/Users/anagnole/Projects/ThesisBrainifai/.brainifai
cd /Users/anagnole/Projects/Brainifai
exec npx tsx src/mcp/index.ts
