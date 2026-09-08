"""
Payments, behind an interface.

Requirement 23 asks for the architecture rather than an integration, and is
explicit that card details must never be stored. So:

  - No card data enters this process, ever. A provider returns a reference
    string; that reference is the only thing persisted.
  - The provider is chosen by configuration, not by an import, so adding
    Razorpay or Stripe is a new class in this file and one env variable.
  - Enrolment is granted by confirming an order, never by the checkout screen.
    A client that calls the enrolment endpoint directly still has to produce a
    paid order.

MockProvider exists so the whole purchase -> enrolment -> access chain is real
and testable today. It is refused in production.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

from .config import settings


@dataclass(slots=True)
class PaymentIntent:
    provider_ref: str
    #: What the client needs to complete payment. Shape differs per provider.
    client_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PaymentResult:
    paid: bool
    provider_ref: str
    failure_reason: str | None = None


class PaymentProvider(Protocol):
    name: str

    async def create_intent(
        self, *, order_id: str, amount_minor: int, currency: str, email: str
    ) -> PaymentIntent: ...

    async def confirm(
        self, *, order_id: str, provider_ref: str, token: str | None = None
    ) -> PaymentResult: ...


class MockProvider:
    """
    Development provider. Confirms immediately so the end-to-end flow works
    without an account anywhere. A `token` of "fail" is rejected, so the
    unhappy path is exercisable too.
    """

    name = "mock"

    async def create_intent(
        self, *, order_id: str, amount_minor: int, currency: str, email: str
    ) -> PaymentIntent:
        return PaymentIntent(
            provider_ref=f"mock_{order_id[:8]}_{uuid.uuid4().hex[:8]}",
            client_payload={
                "provider": "mock",
                "amountMinor": amount_minor,
                "currency": currency,
                "note": "Development provider. No card details are collected or stored.",
            },
        )

    async def confirm(
        self, *, order_id: str, provider_ref: str, token: str | None = None
    ) -> PaymentResult:
        if token == "fail":
            return PaymentResult(
                paid=False,
                provider_ref=provider_ref,
                failure_reason="The payment was declined by the bank.",
            )
        return PaymentResult(paid=True, provider_ref=provider_ref)


# Sketch of the real thing, kept as a comment rather than a half-built class:
#
#   class RazorpayProvider:
#     create_intent() -> POST /v1/orders, return provider_ref=order.id,
#                        client_payload={key_id, order_id}
#     confirm()       -> verify the razorpay_signature HMAC against the order id
#                        and payment id; never trust the client's word for it
#
# The important part is already true: nothing above the interface knows the
# difference, and confirmation is a server-side verification rather than the
# browser telling us it went well.


def _build() -> PaymentProvider:
    chosen = settings.payment_provider
    if chosen == "mock":
        if settings.is_prod:
            raise RuntimeError("The mock payment provider must not run in production.")
        return MockProvider()
    raise RuntimeError(f'Unknown payment provider "{chosen}". Add it to payments.py.')


payments: PaymentProvider = _build()
