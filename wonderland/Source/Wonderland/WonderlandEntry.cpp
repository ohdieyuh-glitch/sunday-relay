#include "WonderlandEntry.h"

bool WonderlandEntryIsInside(const FWonderlandEntry& Entry)
{
	// Presenting, and nothing else. Not Admitted, which means the world let this
	// person in and may still be showing them nothing; not Offered, which means
	// a renderer was asked and has not answered. A renderer confirming is the
	// only evidence that anybody can see Wonderland, and this is the one place
	// that evidence is read.
	return Entry.Presentation == EWonderlandPresentation::Presenting;
}

bool WonderlandEntryMayRequest(const FWonderlandEntry& Entry)
{
	// A join in flight must not be joined again: a second request is a second
	// presence, and the world would then hold two for one person. Once admitted
	// there is nothing left to ask for — the remaining work is rendering.
	return Entry.Admission == EWonderlandAdmission::NotRequested
		|| Entry.Admission == EWonderlandAdmission::Refused;
}
