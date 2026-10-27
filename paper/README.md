# NexaMind paper

IEEE conference paper (IEEEtran, 8 pages, bibliography included).

| File | What it is |
|---|---|
| `nexamind.tex` | The paper |
| `fig_architecture.tex` | Fig. 1 (TikZ) |
| `generated/results.tex` | Every reported number, as LaTeX macros |
| `generated/e4_table.tex`, `generated/e5_table.tex` | Tables IV-V |

Files in `generated/` are written by `backend/eval/summarize_v2.py` from the raw trial records. Never edit them by hand.

## Compile

Upload the whole `paper/` folder to Overleaf, or locally run `pdflatex nexamind.tex` twice so references resolve.

## Before submitting

- Fill in the author block, and `\commitID` / `\artifactURL` at the top of `nexamind.tex`.
- Commit the code and the raw results, tag the commit, and use that tag as `\commitID`.
- Check the venue's AI-use policy. IEEE requires AI-generated content to be disclosed in the acknowledgments.

## Reproducing the numbers (from `backend/`)

| Experiments | Command | Output |
|---|---|---|
| E1-E3 (planner, access control, latency) | `python -m eval.run_eval` | `eval/results.json` |
| E4-E5, model Lite | `python -m eval.run_llm_eval_v2 --provider gemini --model gemini-flash-lite-latest` | `eval/results_v2/*.jsonl` |
| E5 without the untrusted-content rule | the same command with `--ablation` | `eval/results_v2/*-norule.jsonl` |
| E4-E5, model Flash | `python -m eval.run_llm_eval_v2 --provider gemini --model gemini-3.5-flash` | `eval/results_v2/*.jsonl` |
| Numbers and tables in the paper | `python -m eval.summarize_v2` | `../paper/generated/` |

Live runs need `GEMINI_API_KEY`. They append one record per trial, so a run stopped by a quota limit resumes where it stopped. Latency depends on hardware, and live results depend on the provider's models at the time of the run.
