# Evaluation Results

## Overall Scores

| System | Score | Avg Latency | Errors |
|--------|-------|-------------|--------|
| graph | 80.7% | 12213ms | 0 |
| sql | 76.0% | 4766ms | 0 |
| sql-fts | 76.0% | 4843ms | 0 |
| llm-only | 76.0% | 4950ms | 0 |

## Scores by Question Type

| System | simple-lookup | multi-hop | temporal | cohort | reasoning |
|--------|------|------|------|------|------|
| graph | 80.7% | 0.0% | 0.0% | 0.0% | 0.0% |
| sql | 76.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sql-fts | 76.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| llm-only | 76.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## Scores by Domain

| System | cardiovascular | conditions | demographics | diabetes | general | guidelines | labs | medications | procedures | providers | renal |
|--------|------|------|------|------|------|------|------|------|------|------|------|
| graph | 66.7% | 100.0% | 70.0% | 66.7% | 0.0% | 0.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |
| sql | 66.7% | 100.0% | 80.0% | 33.3% | 0.0% | 0.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |
| sql-fts | 66.7% | 100.0% | 80.0% | 33.3% | 0.0% | 0.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |
| llm-only | 66.7% | 100.0% | 80.0% | 33.3% | 0.0% | 0.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |