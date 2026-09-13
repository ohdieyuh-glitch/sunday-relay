using UnrealBuildTool;
using System.Collections.Generic;

public class WonderlandEditorTarget : TargetRules
{
	public WonderlandEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;

		// UE 5.8 SETTINGS, PINNED EXPLICITLY.
		//
		// These were BuildSettingsVersion.V5 and
		// EngineIncludeOrderVersion.Unreal5_4, and that combination did not merely
		// warn — it FAILED the editor target on a real L4 with
		// OtherCompilationError / ExitCode=6:
		//
		//   WonderlandEditor modifies the values of properties:
		//   [ UndefinedIdentifierWarningLevel: Off != Error, ... ]
		//   This is not allowed, as WonderlandEditor has build products in
		//   common with UnrealEditor.
		//
		// The cause is not those warning levels; nothing here sets them. Asking
		// for a LEGACY include order is what makes UBT relax them, so that
		// pre-5.8 code still compiles. WonderlandEditor shares build products
		// with UnrealEditor, whose shared environment has them at Error, and a
		// target in a shared build environment may not modify such properties.
		//
		// So the fix is to stop requesting a legacy include order, not to
		// suppress the check. UBT offers bOverrideBuildEnvironment and
		// TargetBuildEnvironment.Unique, and both are the wrong answer here:
		// Epic's own documentation describes bOverrideBuildEnvironment as
		// "whether to IGNORE VIOLATIONS to the shared build environment", which
		// silences the report and leaves this target compiling engine headers
		// under different warning rules than the engine did. Unique would fix it
		// by giving up sharing entirely and rebuilding the engine per target —
		// hours of L4 time to avoid a two-line migration.
		//
		// Explicit versions rather than Latest: every other part of this pipeline
		// pins 5.8 by name — the container tag, and build-wonderland.sh's hard
		// version assertion — and Latest would silently change these semantics
		// under a future engine bump instead of failing loudly the way the rest
		// of the pin does.
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;

		ExtraModuleNames.Add("Wonderland");
	}
}
