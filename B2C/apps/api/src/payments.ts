/**
 * Payments, behind an interface.
 *
 * Requirement 23 asks for the architecture rather than an integration, and is
 * explicit that card details must never be stored. So:
 *
 *   - No card data enters this process, ever. A provider returns a reference
 *     string; that reference is the only thing persisted.
 *   - The provider is chosen by configuration, not by an import, so adding
 *     Razorpay or Stripe is a new class in this file and one env variable.
 *   - Enrolment is granted by confirming an order, never by the checkout screen.
 *     A client that calls the enrolment endpoint directly still has to produce a
 *     paid order.
 *
 * MockProvider exists so the whole purchase → enrolment → access chain is real
 * and testable today. It is refused in production.
 */

import { randomUUID } from 'node:crypto'
import { env } from './env.ts'

export type PaymentIntent = {
  providerRef: string
  /** What the client needs to complete payment. Shape differs per provider. */
  clientPayload: Record<string, unknown>
}

export type PaymentResult = {
  paid: boolean
  providerRef: string
  failureReason?: string
}

export interface PaymentProvider {
  readonly name: string
  createIntent(input: { orderId: string; amountMinor: number; currency: string; email: string }): Promise<PaymentIntent>
  confirm(input: { orderId: string; providerRef: string; token?: string }): Promise<PaymentResult>
}

/**
 * Development provider. Confirms immediately so the end-to-end flow works
 * without an account anywhere. A `token` of "fail" is rejected, so the unhappy
 * path is exercisable too.
 */
class MockProvider implements PaymentProvider {
  readonly name = 'mock'

  async createIntent({ orderId, amountMinor, currency }: { orderId: string; amountMinor: number; currency: string }) {
    return {
      providerRef: `mock_${orderId.slice(0, 8)}_${randomUUID().slice(0, 8)}`,
      clientPayload: {
        provider: 'mock',
        amountMinor, currency,
        note: 'Development provider. No card details are collected or stored.',
      },
    }
  }

  async confirm({ providerRef, token }: { orderId: string; providerRef: string; token?: string }) {
    if (token === 'fail') {
      return { paid: false, providerRef, failureReason: 'The payment was declined by the bank.' }
    }
    return { paid: true, providerRef }
  }
}

/**
 * Sketch of the real thing, kept as a comment rather than a half-built class:
 *
 *   class RazorpayProvider implements PaymentProvider {
 *     createIntent() -> POST /v1/orders, return { providerRef: order.id, clientPayload: { key_id, order_id } }
 *     confirm()      -> verify the razorpay_signature HMAC against the order id
 *                       and payment id; never trust the client's word for it
 *   }
 *
 * The important part is already true: nothing above the interface knows the
 * difference, and confirmation is a server-side verification rather than the
 * browser telling us it went well.
 */

function build(): PaymentProvider {
  const chosen = process.env.PAYMENT_PROVIDER ?? 'mock'
  if (chosen === 'mock') {
    if (env.isProd) throw new Error('The mock payment provider must not run in production.')
    return new MockProvider()
  }
  throw new Error(`Unknown payment provider "${chosen}". Add it to payments.ts.`)
}

export const payments: PaymentProvider = build()
