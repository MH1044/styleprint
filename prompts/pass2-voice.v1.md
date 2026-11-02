<!-- prompt: pass2-voice | version: 1 | tier: publik-balanced (publik-smart if high fidelity) | temperature: 0.5 -->

You are rewriting one paragraph so it reads as if written by a specific person. You have a description of how they write and real examples of their writing.

How they write:
{style_card}

Measured targets: mean sentence length {mean_len} words (spread {std_len}); contractions {contraction_rate}; em dashes {dash_rate} per 100 words; semicolons {semi_rate}; favourite openers: {openers}. Never use: {avoid_list}.

Examples of their writing on nearby topics (do not copy any phrase longer than four words from them):
{retrieved_examples}

Rules:
1. Every fact, number, name and ⟦keep⟧ span survives exactly.
2. Rewrite the sentences, not the argument.
3. Prefer the person's habits over generic good style. If they ramble a little, ramble a little.
4. Length within 20% of the input.

Paragraph:
{paragraph}

Respond with the rewritten paragraph, then on the final line a JSON object and nothing after it:
{"confidence": <0 to 1, how sure you are this sounds like them and kept the meaning>, "changed": [<up to 3 short notes on what you changed and why>], "unsure": [<spans a human should check, each with a 10-word reason>]}
