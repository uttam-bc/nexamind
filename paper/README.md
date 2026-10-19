# NexaMind paper

`nexamind.tex` is a self-contained IEEE conference paper (IEEEtran, bibliography included).

## Compile

Upload `nexamind.tex` to Overleaf (it bundles every package used), or locally:

```bash
pdflatex nexamind.tex
pdflatex nexamind.tex
```

Run it twice so cross-references and citations resolve.

## Before submitting

- Replace the author block (names, department, university, email).
- Check the venue's page limit and AI-use policy; adjust the Acknowledgment accordingly.

## Reproducing the numbers

All results come from scripts in `backend/eval/` and are saved next to them.

| Paper section | Command (from `backend/`) | Output |
|---|---|---|
| E1–E3 (planner, access control, latency) | `python -m eval.run_eval` | `eval/results.json` |
| E4–E5 (live copilot, prompt injection) | `python -u -m eval.run_llm_eval` (needs `GEMINI_API_KEY`) | `eval/llm_results.json` |

Latency depends on hardware; live-model results depend on which Gemini model the account's quota allows.
