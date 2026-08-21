#!/usr/bin/env python3
"""Is the deployment region explicitly one of the sanctioned US-West regions?

Wonderland must not land on an arbitrary east-coast or central GPU. The guard is
an allow-list rather than a warning, because a warning is not a prevention.

Exit 0 the region is stated and allowed   1 it is not
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENVF = os.path.normpath(os.path.join(HERE, "..", "gcp", "wonderland-region.env"))


def read_default(text, key):
    m = re.search(r'^%s="\$\{%s:-([^}]*)\}"' % (key, key), text, re.M)
    if m:
        return m.group(1)
    m = re.search(r'^%s="([^"]*)"' % key, text, re.M)
    return m.group(1) if m else None


def main():
    if not os.path.isfile(ENVF):
        print("FAIL: no wonderland-region.env — the region would be whatever the "
              "provider chose, which is the failure this guard exists for.")
        return 1
    text = io.open(ENVF, encoding="utf8").read()

    allowed = (os.environ.get("WL_GCP_ALLOWED_REGIONS")
               or read_default(text, "WL_GCP_ALLOWED_REGIONS") or "").split()
    region = os.environ.get("WL_GCP_REGION") or read_default(text, "WL_GCP_REGION")

    if not allowed:
        print("FAIL: no allow-list of regions is defined.")
        return 1
    if not region:
        print("FAIL: no region is stated. Wonderland is never deployed to an "
              "unstated region.")
        return 1
    print("region: %s" % region)
    print("allowed: %s" % " ".join(allowed))
    if region not in allowed:
        print("FAIL: %s is not a sanctioned US-West region. Allowed: %s"
              % (region, ", ".join(allowed)))
        return 1
    # An allowed region is not by itself a quality claim, and saying so here
    # stops "we deployed to Las Vegas" from being read as "the stream is good".
    print("PASS: region is explicit and US-West.")
    print("NOTE: region is necessary, not sufficient. Connection quality is only "
          "established by verify-stream-quality.py against a real session.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
