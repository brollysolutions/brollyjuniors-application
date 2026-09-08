"""
Branding lives in one object, not scattered through a hundred components.

Today it is a constant, because the platform is Brolly Juniors and nothing
else. The point of the indirection is that when B2B arrives, this becomes a
lookup — the components that read it do not change, because they already read
`brand.name` rather than writing "Brolly Juniors" inline.
"""
from __future__ import annotations

from typing import TypedDict


class Brand(TypedDict):
    name: str
    shortName: str
    logoText: str
    tagline: str
    primaryColor: str
    secondaryColor: str
    supportEmail: str
    supportPhone: str
    city: str
    legalName: str
    currency: str
    currencySymbol: str


BROLLY_JUNIORS: Brand = {
    "name": "Brolly Juniors",
    "shortName": "Brolly",
    "logoText": "BJ",
    "tagline": "Python and AI, taught properly.",
    "primaryColor": "#FFC93C",
    "secondaryColor": "#2B6CB0",
    "supportEmail": "hello@brollyjuniors.com",
    "supportPhone": "+91 98••• •••••",
    "city": "Hyderabad, Telangana",
    "legalName": "Brolly Software Solutions",
    "currency": "INR",
    "currencySymbol": "₹",
}


def resolve_brand(_hint: str | None = None) -> Brand:
    """
    Resolve the brand for a request.

    One implementation today. When B2B lands this takes a host or an org id and
    returns that organisation's brand — and every caller already works.
    """
    return BROLLY_JUNIORS
