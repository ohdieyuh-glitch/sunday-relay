using UnrealBuildTool;

public class Wonderland : ModuleRules
{
	public Wonderland(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			// The Relay Bridge sync layer. HTTP only — Wonderland speaks to
			// Relay exclusively through the Bridge's explicit read contract.
			"HTTP",
			"Json",
			"JsonUtilities",
			"DeveloperSettings",
			// World UI (built from the Figma system).
			"UMG",
			"Slate",
			"SlateCore"
		});
	}
}
