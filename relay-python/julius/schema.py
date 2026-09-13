"""Validation against the canonical Project Brain body schemas.

The table is ``brain_schema.json``, generated from the TypeScript domain's
``JULIUS_BRAIN_BODY_SCHEMAS`` and held current by a test, so a record the SDK
accepts is a record the Brain's planner will accept. Julius validates again on
the way in; this exists so a script learns about a bad record at the line
that staged it, not after the execution ended.
"""

import re

from .errors import JuliusBrainValidationError


def _field_errors(spec, value, path):
    if value is None:
        return [] if spec.get("nullable") else ["%s: may not be null" % path]
    kind = spec["type"]
    if kind == "string":
        if not isinstance(value, str):
            return ["%s: must be a string" % path]
        if "maxLength" in spec and len(value) > spec["maxLength"]:
            return ["%s: longer than %d" % (path, spec["maxLength"])]
        if "enum" in spec and value not in spec["enum"]:
            return ["%s: not one of %s" % (path, "|".join(spec["enum"]))]
        if "pattern" in spec and not re.search(spec["pattern"], value):
            return ["%s: does not match %s" % (path, spec["pattern"])]
        return []
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return ["%s: must be a finite number" % path]
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return ["%s: must be a finite number" % path]
        if spec.get("integer") and not (isinstance(value, int) or float(value).is_integer()):
            return ["%s: must be an integer" % path]
        if "min" in spec and value < spec["min"]:
            return ["%s: below %s" % (path, spec["min"])]
        if "max" in spec and value > spec["max"]:
            return ["%s: above %s" % (path, spec["max"])]
        return []
    if kind == "boolean":
        return [] if isinstance(value, bool) else ["%s: must be a boolean" % path]
    if kind == "string[]":
        if not isinstance(value, list):
            return ["%s: must be a list" % path]
        if "maxItems" in spec and len(value) > spec["maxItems"]:
            return ["%s: more than %d items" % (path, spec["maxItems"])]
        item_spec = {"type": "string"}
        if "maxLength" in spec:
            item_spec["maxLength"] = spec["maxLength"]
        if "enum" in spec:
            item_spec["enum"] = spec["enum"]
        errors = []
        for index, item in enumerate(value):
            errors.extend(_field_errors(item_spec, item, "%s[%d]" % (path, index)))
        return errors
    if kind == "object":
        return object_errors(spec["fields"], value, path)
    if kind == "object[]":
        if not isinstance(value, list):
            return ["%s: must be a list" % path]
        if "maxItems" in spec and len(value) > spec["maxItems"]:
            return ["%s: more than %d items" % (path, spec["maxItems"])]
        errors = []
        for index, item in enumerate(value):
            errors.extend(object_errors(spec["fields"], item, "%s[%d]" % (path, index)))
        return errors
    if kind == "scalarMap":
        if not isinstance(value, dict):
            return ["%s: must be an object" % path]
        if "maxEntries" in spec and len(value) > spec["maxEntries"]:
            return ["%s: more than %d entries" % (path, spec["maxEntries"])]
        errors = []
        for key, item in value.items():
            if item is not None and not isinstance(item, (str, bool, int, float)):
                errors.append("%s.%s: must be a scalar" % (path, key))
            elif isinstance(item, str) and len(item) > 512:
                errors.append("%s.%s: longer than 512" % (path, key))
        return errors
    if kind == "json":
        return []
    return ["%s: unknown schema type %s" % (path, kind)]


def object_errors(fields, value, path="body"):
    if not isinstance(value, dict):
        return ["%s: must be an object" % path]
    errors = ["%s.%s: unknown field" % (path, key) for key in value if key not in fields]
    for key, spec in fields.items():
        if key not in value:
            errors.append("%s.%s: required" % (path, key))
            continue
        errors.extend(_field_errors(spec, value[key], "%s.%s" % (path, key)))
    return errors


def validate_body(schema, kind, body):
    if kind not in schema["kinds"]:
        raise JuliusBrainValidationError("unknown record kind %s" % kind)
    errors = object_errors(schema["kinds"][kind], body)
    if errors:
        raise JuliusBrainValidationError(
            "%s body is invalid: %s" % (kind, "; ".join(errors[:6])), errors
        )
