import json, sys
rel = json.load(open(sys.argv[1])); fx = {r["name"]: r for r in json.load(open(sys.argv[2]))["targets"]}
def pick(pred):
    return next(n for n, r in fx.items() if pred(r))
picks = [
 ("state balance (Alabama)", pick(lambda r: r["metadata"]["target_role"]=="fsa_state_balance" and r["metadata"].get("state_fips")=="01")),
 ("age band borrowers (24 and Younger)", pick(lambda r: r["metadata"]["target_role"]=="fsa_age_band_borrowers" and "age_lower_bound" not in r["metadata"])),
 ("debt-size band balance (10K to 20K)", pick(lambda r: r["metadata"]["target_role"]=="fsa_debt_size_band_balance" and r["metadata"].get("fsa_balance_lower_bound")=="10000")),
 ("Parent PLUS balance", pick(lambda r: r["metadata"]["target_role"]=="fsa_parent_plus_balance")),
 ("balance excluding Parent PLUS", pick(lambda r: r["metadata"]["target_role"]=="fsa_balance_excluding_parent_plus")),
]
for title, name in picks:
    a = rel[name]["after_aging"]; b = fx[name]["metadata"]
    print(f"\n=== {title}: {name}")
    print(f"{'key':48} {'release (after aging)':42} {'fixture':42} verdict")
    for k in list(dict.fromkeys([*a, *b])):
        va, vb = a.get(k, "<absent>"), b.get(k, "<absent>")
        verdict = "same" if va == vb else ("MISSING in fixture" if k not in b else ("EXTRA in fixture" if k not in a else "DIFFERS"))
        print(f"{k:48} {str(va)[:42]:42} {str(vb)[:42]:42} {verdict}")
