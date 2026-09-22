#include "WonderlandCompanionFigure.h"

namespace
{
	bool ReadFloat(const TArray<FString>& Tokens, int32 Index, float& Out)
	{
		if (!Tokens.IsValidIndex(Index) || !FCString::IsNumeric(*Tokens[Index]))
		{
			return false;
		}
		Out = FCString::Atof(*Tokens[Index]);
		return FMath::IsFinite(Out);
	}

	bool ReadVector(const TArray<FString>& Tokens, int32 Index, FVector& Out)
	{
		float X = 0.0f, Y = 0.0f, Z = 0.0f;
		if (!ReadFloat(Tokens, Index, X) || !ReadFloat(Tokens, Index + 1, Y) || !ReadFloat(Tokens, Index + 2, Z))
		{
			return false;
		}
		Out = FVector(X, Y, Z);
		return true;
	}

	bool ReadKind(const FString& Token, EWonderlandCompanionMaterialKind& Out)
	{
		if (Token == TEXT("lit")) { Out = EWonderlandCompanionMaterialKind::Lit; return true; }
		if (Token == TEXT("rim")) { Out = EWonderlandCompanionMaterialKind::Rim; return true; }
		if (Token == TEXT("glow")) { Out = EWonderlandCompanionMaterialKind::Glow; return true; }
		if (Token == TEXT("add")) { Out = EWonderlandCompanionMaterialKind::Additive; return true; }
		return false;
	}

	bool ReadMotion(const FString& Token, EWonderlandCompanionMotion& Out)
	{
		if (Token == TEXT("none")) { Out = EWonderlandCompanionMotion::None; return true; }
		if (Token == TEXT("float")) { Out = EWonderlandCompanionMotion::Float; return true; }
		if (Token == TEXT("head")) { Out = EWonderlandCompanionMotion::Head; return true; }
		if (Token == TEXT("wing")) { Out = EWonderlandCompanionMotion::Wing; return true; }
		if (Token == TEXT("tail")) { Out = EWonderlandCompanionMotion::Tail; return true; }
		if (Token == TEXT("orbit")) { Out = EWonderlandCompanionMotion::Orbit; return true; }
		if (Token == TEXT("blink")) { Out = EWonderlandCompanionMotion::Blink; return true; }
		if (Token == TEXT("twinkle")) { Out = EWonderlandCompanionMotion::Twinkle; return true; }
		if (Token == TEXT("stride")) { Out = EWonderlandCompanionMotion::Stride; return true; }
		if (Token == TEXT("knee")) { Out = EWonderlandCompanionMotion::Knee; return true; }
		if (Token == TEXT("spine")) { Out = EWonderlandCompanionMotion::Spine; return true; }
		if (Token == TEXT("trail")) { Out = EWonderlandCompanionMotion::Trail; return true; }
		return false;
	}
}

int32 FWonderlandCompanionFigure::FindPart(FName Name) const
{
	return Parts.IndexOfByPredicate([Name](const FWonderlandCompanionPart& Part) { return Part.Name == Name; });
}

int32 FWonderlandCompanionFigure::FindMaterial(FName Name) const
{
	return Materials.IndexOfByPredicate([Name](const FWonderlandCompanionMaterial& Material) { return Material.Name == Name; });
}

bool FWonderlandCompanionFigure::Parse(const FString& Text, FWonderlandCompanionFigure& OutFigure, FString& OutError)
{
	// Built aside and moved in only when the whole file is good: all or nothing.
	FWonderlandCompanionFigure Figure;
	OutFigure = FWonderlandCompanionFigure();
	OutError.Reset();

	TArray<FString> Lines;
	Text.ParseIntoArrayLines(Lines, false);
	bool bHeader = false;

	for (int32 LineIndex = 0; LineIndex < Lines.Num(); ++LineIndex)
	{
		FString Line = Lines[LineIndex];
		int32 Hash = INDEX_NONE;
		if (Line.FindChar(TEXT('#'), Hash))
		{
			Line.LeftInline(Hash);
		}
		Line.TrimStartAndEndInline();
		if (Line.IsEmpty())
		{
			continue;
		}

		TArray<FString> Tokens;
		Line.ParseIntoArrayWS(Tokens);
		const FString& Keyword = Tokens[0];
		const auto Fail = [&OutError, LineIndex, &Line](const TCHAR* Why)
		{
			OutError = FString::Printf(TEXT("line %d: %s -- \"%s\""), LineIndex + 1, Why, *Line);
			return false;
		};

		if (Keyword == TEXT("wlvox"))
		{
			if (Tokens.Num() < 2 || Tokens[1] != TEXT("1"))
			{
				return Fail(TEXT("unsupported format version (expected `wlvox 1`)"));
			}
			bHeader = true;
			continue;
		}
		if (!bHeader)
		{
			return Fail(TEXT("the first record must be `wlvox 1`"));
		}

		if (Keyword == TEXT("voxel"))
		{
			float Voxel = 0.0f;
			if (!ReadFloat(Tokens, 1, Voxel) || Voxel <= 0.01f || Voxel > 100.0f)
			{
				return Fail(TEXT("voxel size must be a number between 0.01 and 100 uu"));
			}
			Figure.VoxelUU = Voxel;
		}
		else if (Keyword == TEXT("material"))
		{
			FWonderlandCompanionMaterial Material;
			float R = 0.0f, G = 0.0f, B = 0.0f;
			if (Tokens.Num() < 6 || !ReadKind(Tokens[2], Material.Kind)
				|| !ReadFloat(Tokens, 3, R) || !ReadFloat(Tokens, 4, G) || !ReadFloat(Tokens, 5, B))
			{
				return Fail(TEXT("expected `material <name> <lit|rim|glow|add> <r> <g> <b> [strength]`"));
			}
			Material.Name = FName(*Tokens[1]);
			Material.Color = FLinearColor(FMath::Max(R, 0.0f), FMath::Max(G, 0.0f), FMath::Max(B, 0.0f), 1.0f);
			if (Tokens.Num() > 6 && !ReadFloat(Tokens, 6, Material.Strength))
			{
				return Fail(TEXT("material strength must be a number"));
			}
			if (Figure.FindMaterial(Material.Name) != INDEX_NONE)
			{
				return Fail(TEXT("material declared twice"));
			}
			if (Figure.Materials.Num() >= MaxMaterials)
			{
				return Fail(TEXT("too many materials"));
			}
			Figure.Materials.Add(Material);
		}
		else if (Keyword == TEXT("part"))
		{
			FWonderlandCompanionPart Part;
			if (Tokens.Num() < 7 || !ReadVector(Tokens, 3, Part.Pivot) || !ReadMotion(Tokens[6], Part.Motion))
			{
				return Fail(TEXT("expected `part <name> <parent|-> <x> <y> <z> <motion> [a] [b]`"));
			}
			Part.Name = FName(*Tokens[1]);
			if (Figure.FindPart(Part.Name) != INDEX_NONE)
			{
				return Fail(TEXT("part declared twice"));
			}
			if (Tokens[2] == TEXT("-"))
			{
				if (Figure.Parts.Num() > 0)
				{
					return Fail(TEXT("only the first part may be the root"));
				}
			}
			else
			{
				Part.Parent = Figure.FindPart(FName(*Tokens[2]));
				if (Part.Parent == INDEX_NONE)
				{
					return Fail(TEXT("parent must be declared before its children"));
				}
			}
			if (Figure.Parts.Num() == 0 && Part.Parent != INDEX_NONE)
			{
				return Fail(TEXT("the first part must be the root, with parent `-`"));
			}
			if ((Tokens.Num() > 7 && !ReadFloat(Tokens, 7, Part.A)) || (Tokens.Num() > 8 && !ReadFloat(Tokens, 8, Part.B)))
			{
				return Fail(TEXT("motion arguments must be numbers"));
			}
			if (Figure.Parts.Num() >= MaxParts)
			{
				return Fail(TEXT("too many parts"));
			}
			Figure.Parts.Add(Part);
		}
		else if (Keyword == TEXT("box"))
		{
			FWonderlandCompanionBox Box;
			if (Tokens.Num() < 9 || !ReadVector(Tokens, 3, Box.Centre) || !ReadVector(Tokens, 6, Box.Size))
			{
				return Fail(TEXT("expected `box <part> <material> <x> <y> <z> <sx> <sy> <sz> [pitch yaw roll]`"));
			}
			Box.Part = Figure.FindPart(FName(*Tokens[1]));
			Box.Material = Figure.FindMaterial(FName(*Tokens[2]));
			if (Box.Part == INDEX_NONE || Box.Material == INDEX_NONE)
			{
				return Fail(TEXT("box names a part or material that has not been declared"));
			}
			if (Box.Size.X <= 0.0 || Box.Size.Y <= 0.0 || Box.Size.Z <= 0.0)
			{
				return Fail(TEXT("box size must be positive on every axis"));
			}
			if (Tokens.Num() >= 12)
			{
				FVector Euler;
				if (!ReadVector(Tokens, 9, Euler))
				{
					return Fail(TEXT("box rotation must be three numbers: pitch yaw roll"));
				}
				Box.Rotation = FRotator(Euler.X, Euler.Y, Euler.Z);
			}
			if (Figure.Boxes.Num() >= MaxBoxes)
			{
				return Fail(TEXT("too many boxes"));
			}
			Figure.Boxes.Add(Box);
		}
		else
		{
			return Fail(TEXT("unknown record"));
		}
	}

	if (!bHeader)
	{
		OutError = TEXT("empty figure: no `wlvox 1` header");
		return false;
	}
	if (Figure.Parts.Num() == 0 || Figure.Boxes.Num() == 0)
	{
		OutError = TEXT("a figure needs at least one part and one box");
		return false;
	}
	OutFigure = MoveTemp(Figure);
	return true;
}
