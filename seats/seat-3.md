assignment: 2
role: review
branch: feat/h1-stock-ledger
run_file: docs/runs/phase3/h1-stock-ledger.md
wait_for: report: h1-stock-ledger done
note: Tier A, the ledger every later Phase 3 slice moves stock through. Attack app.stock_move(): lock order and deadlocks, a balance that can differ from its movements, a cost that leaks to someone without finance.cost.read (DTO, event, audit value, notification, error detail, import report, valuation), serial states out of step, reversal and opening-stock rules, row security per role and company, and the commands each refusal maps to. Re-run the property and concurrency tests. Journeys cannot sign in in the cloud: read their specs and say which were not run
