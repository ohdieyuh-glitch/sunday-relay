"""Wonderland HD — authored geometry, the asset library, and the editor bridge.

A package rather than three loose modules so `generate-hub-level.py` can import
it by name from HERE without putting a directory called `build` on sys.path and
shadowing something in the engine's own Python.
"""
