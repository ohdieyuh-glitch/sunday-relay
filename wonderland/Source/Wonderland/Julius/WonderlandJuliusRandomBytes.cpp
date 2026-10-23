#include "WonderlandJuliusRandomBytes.h"

#include "IPlatformCrypto.h"

bool FWonderlandJuliusPlatformCryptoRandom::Fill(std::uint8_t (&OutBytes)[16])
{
	for (int Index = 0; Index < 16; ++Index) { OutBytes[Index] = 0; }
	if (!IPlatformCrypto::IsAvailable()) { return false; }
	TUniquePtr<FEncryptionContext> Context = IPlatformCrypto::Get().CreateContext();
	if (!Context.IsValid()) { return false; }
	const TArrayView<uint8> View(OutBytes, 16);
	const EPlatformCryptoResult Result = Context->CreateRandomBytes(View);
	if (Result != EPlatformCryptoResult::Success)
	{
		for (int Index = 0; Index < 16; ++Index) { OutBytes[Index] = 0; }
		return false;
	}
	return true;
}
