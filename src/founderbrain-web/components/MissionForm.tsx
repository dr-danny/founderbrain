/**
 * Mission fieldsets for identity, customer, offer, and voice.
 * Output mission content lives in Output.tsx; App owns save/approve actions.
 */
import type { Brain } from "../types";
import type { Mission } from "../mission-copy";
import { Field, Text } from "./Fields";
import { Summary } from "./Summary";

export function MissionForm({
  mission,
  draft,
  saving,
  onPatch,
}: {
  mission: Exclude<Mission, "output">;
  draft: Brain;
  saving: boolean;
  onPatch: (section: Exclude<Mission, "output">, field: string, value: string | boolean) => void;
}) {
  if (mission === "identity") {
    return (
      <fieldset className="mission-fields" disabled={saving}>
        <div className="form-grid">
          <Field
            id="name"
            label="Your name"
            value={draft.identity.name}
            onChange={(v) => onPatch("identity", "name", v)}
            required
          />
          <Field
            id="venture"
            label="Venture"
            value={draft.identity.venture}
            onChange={(v) => onPatch("identity", "venture", v)}
            required
          />
          <Field
            id="role"
            label="Role"
            value={draft.identity.role}
            onChange={(v) => onPatch("identity", "role", v)}
            required
          />
          <label className="field" htmlFor="stage">
            <span>Stage</span>
            <select
              id="stage"
              value={draft.identity.stage}
              onChange={(e) => onPatch("identity", "stage", e.target.value)}
            >
              <option value="exploring">Exploring</option>
              <option value="building">Building</option>
              <option value="launched">Launched</option>
              <option value="growing">Growing</option>
            </select>
          </label>
          <Text
            id="goal"
            label="What needs to change?"
            value={draft.identity.goal}
            onChange={(v) => onPatch("identity", "goal", v)}
            required
          />
        </div>
      </fieldset>
    );
  }

  if (mission === "customer") {
    return (
      <>
        <fieldset className="mission-fields" disabled={saving}>
          <div className="form-grid">
            <Field
              id="segment"
              label="Customer segment"
              value={draft.customer.segment}
              onChange={(v) => onPatch("customer", "segment", v)}
              required
            />
            <Text
              id="problem"
              label="Problem"
              value={draft.customer.problem}
              onChange={(v) => onPatch("customer", "problem", v)}
              required
            />
            <Text
              id="customer-outcome"
              label="Desired outcome"
              value={draft.customer.outcome}
              onChange={(v) => onPatch("customer", "outcome", v)}
              required
            />
            <Text
              id="workaround"
              label="Current workaround"
              value={draft.customer.workaround}
              onChange={(v) => onPatch("customer", "workaround", v)}
            />
            <label className="field" htmlFor="evidence-status">
              <span>Evidence status</span>
              <select
                id="evidence-status"
                value={draft.customer.evidenceStatus}
                onChange={(e) => onPatch("customer", "evidenceStatus", e.target.value)}
              >
                <option value="hypothesis">Hypothesis</option>
                <option value="supported">Supported</option>
              </select>
            </label>
            <Text
              id="evidence"
              label="Evidence"
              hint="Required when evidence is supported."
              value={draft.customer.evidence}
              onChange={(v) => onPatch("customer", "evidence", v)}
              required={draft.customer.evidenceStatus === "supported"}
            />
          </div>
        </fieldset>
        <Summary customer={draft.customer} />
      </>
    );
  }

  if (mission === "offer") {
    return (
      <fieldset className="mission-fields" disabled={saving}>
        <div className="form-grid">
          <Text
            id="description"
            label="Offer"
            value={draft.offer.description}
            onChange={(v) => onPatch("offer", "description", v)}
            required
          />
          <Text
            id="delivery"
            label="Delivery"
            value={draft.offer.delivery}
            onChange={(v) => onPatch("offer", "delivery", v)}
            required
          />
          <Text
            id="offer-outcome"
            label="Outcome"
            value={draft.offer.outcome}
            onChange={(v) => onPatch("offer", "outcome", v)}
            required
          />
          <Field
            id="cta"
            label="Call to action"
            value={draft.offer.cta}
            onChange={(v) => onPatch("offer", "cta", v)}
            required
          />
          <Field
            id="price"
            label="Price or pricing frame"
            value={draft.offer.price}
            onChange={(v) => onPatch("offer", "price", v)}
          />
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="mission-fields" disabled={saving}>
      <div className="form-grid">
        <Text
          id="tone"
          label="Tone"
          value={draft.voice.tone}
          onChange={(v) => onPatch("voice", "tone", v)}
          required
        />
        <Text
          id="boundaries"
          label="Boundaries"
          value={draft.voice.boundaries}
          onChange={(v) => onPatch("voice", "boundaries", v)}
          required
        />
        <Text
          id="sample"
          label="Sample"
          value={draft.voice.sample}
          onChange={(v) => onPatch("voice", "sample", v)}
          required
        />
      </div>
    </fieldset>
  );
}
