import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [order, setOrder] = useState(null);
  const [pickupHistory, setPickupHistory] = useState([]);
  const [pickupQuantities, setPickupQuantities] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [step, setStep] = useState("items");

  const [pickupPersonName, setPickupPersonName] = useState("");
  const [pickupPersonType, setPickupPersonType] = useState([]);
  const [idVerified, setIdVerified] = useState([]);

  const [signature, setSignature] = useState(null);
  const [capturingSignature, setCapturingSignature] = useState(false);

  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const orderId = shopify.order.id;

  useEffect(() => {
    loadPickupData();
  }, []);

  async function loadPickupData() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const orderResponse = await fetch(
        `/api/pickup/order?orderId=${encodeURIComponent(orderId)}`
      );

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        throw new Error(
          orderData.error || "Unable to load order"
        );
      }

      const historyResponse = await fetch(
        `/api/pickup/history?orderId=${encodeURIComponent(orderId)}`
      );

      const historyData = await historyResponse.json();

      if (!historyResponse.ok) {
        throw new Error(
          historyData.error || "Unable to load pickup history"
        );
      }

      setOrder(orderData.order);
      setPickupHistory(historyData.pickups || []);

      const startingQuantities = {};

      orderData.order.lineItems.nodes.forEach((item) => {
        startingQuantities[item.id] = 0;
      });

      setPickupQuantities(startingQuantities);
    } catch (err) {
      console.error("Pickup load error:", err);
      setError(
        err?.message || "Unable to load pickup information"
      );
    } finally {
      setLoading(false);
    }
  }

  function getPreviouslyPickedUp(itemId) {
    let total = 0;

    pickupHistory.forEach((pickup) => {
      pickup.items.forEach((item) => {
        if (item.id === itemId) {
          total += Number(item.pickupQuantity) || 0;
        }
      });
    });

    return total;
  }

  function getRemainingQuantity(item) {
    return Math.max(
      0,
      Number(item.quantity) - getPreviouslyPickedUp(item.id)
    );
  }

  function updateQuantity(itemId, value, maxQuantity) {
    let quantity = Number(value);

    if (Number.isNaN(quantity)) {
      quantity = 0;
    }

    quantity = Math.floor(quantity);

    if (quantity < 0) {
      quantity = 0;
    }

    if (quantity > maxQuantity) {
      quantity = maxQuantity;
    }

    setPickupQuantities((current) => ({
      ...current,
      [itemId]: quantity,
    }));

    setMessage("");
  }

  function continueFromItems() {
    const selected = order.lineItems.nodes.filter(
      (item) => (pickupQuantities[item.id] || 0) > 0
    );

    if (selected.length === 0) {
      setMessage(
        "Select at least one item being picked up today."
      );
      return;
    }

    setMessage("");
    setStep("verification");
  }

  function continueFromVerification() {
    if (!pickupPersonName.trim()) {
      setMessage(
        "Enter the name of the person picking up the items."
      );
      return;
    }

    if (pickupPersonType.length === 0) {
      setMessage(
        "Select who is picking up the order."
      );
      return;
    }

    if (idVerified.length === 0) {
      setMessage(
        "Confirm whether identification was verified."
      );
      return;
    }

    setMessage("");
    setStep("review");
  }

  const selectedItems =
    order?.lineItems?.nodes
      ?.filter(
        (item) =>
          (pickupQuantities[item.id] || 0) > 0
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        orderedQuantity: item.quantity,
        previouslyPickedUp:
          getPreviouslyPickedUp(item.id),
        pickupQuantity:
          pickupQuantities[item.id],
      })) || [];

  async function captureSignature() {
    try {
      setCapturingSignature(true);
      setMessage("");

      const photo = await shopify.camera.takePhoto({
        facingMode: "environment",
        quality: 0.7,
        maxWidth: 1200,
        maxHeight: 1200,
      });

      if (!photo?.base64) {
        throw new Error(
          "No signature image was captured."
        );
      }

      setSignature({
        base64: photo.base64,
        type: photo.type || "image/jpeg",
        width: photo.width,
        height: photo.height,
        fileSize: photo.fileSize,
      });

      setMessage("Signature captured successfully.");
    } catch (err) {
      console.error("Signature capture error:", err);
      setMessage(
        err?.message || "Unable to capture signature."
      );
    } finally {
      setCapturingSignature(false);
    }
  }

  async function savePickup() {
    if (!signature?.base64) {
      setMessage(
        "Capture the customer's signature before saving."
      );
      return;
    }

    try {
      setSaving(true);
      setMessage("Saving signed pickup...");

      const response = await fetch("/api/pickup/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          orderName: order.name,
          pickupPersonName:
            pickupPersonName.trim(),
          pickupPersonType:
            pickupPersonType[0],
          idVerified:
            idVerified[0],
          items: selectedItems,
          signature,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to save pickup"
        );
      }

      setMessage("");
      setStep("saved");
    } catch (err) {
      console.error("Save pickup error:", err);

      setMessage(
        err?.message || "Unable to save pickup"
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <s-page heading="New Pickup">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>Loading pickup information...</s-text>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (error) {
    return (
      <s-page heading="New Pickup">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>Error: {error}</s-text>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "verification") {
    return (
      <s-page heading="Pickup Verification">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>Order: {order.name}</s-text>
          </s-box>

          <s-box padding="large">
            <s-text-field
              label="Pickup person's full name"
              value={pickupPersonName}
              onInput={(event) =>
                setPickupPersonName(
                  event.currentTarget.value
                )
              }
            />
          </s-box>

          <s-box padding="large">
            <s-choice-list
              values={pickupPersonType}
              onChange={(event) =>
                setPickupPersonType(
                  event.currentTarget.values
                )
              }
            >
              <s-choice value="customer">
                Customer on the order
              </s-choice>

              <s-choice value="authorized-person">
                Other authorized person
              </s-choice>
            </s-choice-list>
          </s-box>

          <s-box padding="large">
            <s-choice-list
              values={idVerified}
              onChange={(event) =>
                setIdVerified(
                  event.currentTarget.values
                )
              }
            >
              <s-choice value="yes">
                ID verified
              </s-choice>

              <s-choice value="no">
                ID not verified
              </s-choice>
            </s-choice-list>
          </s-box>

          {message && (
            <s-box padding="large">
              <s-text>{message}</s-text>
            </s-box>
          )}

          <s-box padding="large">
            <s-button
              variant="primary"
              onClick={continueFromVerification}
            >
              Continue
            </s-button>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "review") {
    return (
      <s-page heading="Review Pickup">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>
              Pickup person: {pickupPersonName}
            </s-text>
          </s-box>

          {selectedItems.map((item) => (
            <s-box key={item.id} padding="large">
              <s-text>
                {item.name} — Qty {item.pickupQuantity}
              </s-text>
            </s-box>
          ))}

          <s-box padding="large">
            <s-button
              variant="primary"
              onClick={() => {
                setMessage("");
                setStep("signature");
              }}
            >
              Continue to Signature
            </s-button>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "signature") {
    return (
      <s-page heading="Customer Signature">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>
              Have the customer sign the pickup slip,
              then photograph the signature.
            </s-text>
          </s-box>

          <s-box padding="large">
            <s-button
              variant="primary"
              onClick={captureSignature}
            >
              {signature
                ? "Retake Signature"
                : "Capture Signature"}
            </s-button>
          </s-box>

          {signature && (
            <s-box padding="large">
              <s-text>
                Signature captured successfully.
              </s-text>
            </s-box>
          )}

          {message && (
            <s-box padding="large">
              <s-text>{message}</s-text>
            </s-box>
          )}

          <s-box padding="large">
            <s-button
              variant="primary"
              onClick={savePickup}
            >
              {saving
                ? "Saving..."
                : "Save Signed Pickup"}
            </s-button>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (step === "saved") {
    return (
      <s-page heading="Pickup Saved">
        <s-scroll-box>
          <s-box padding="large">
            <s-text>
              Pickup saved successfully.
            </s-text>
          </s-box>

          <s-box padding="large">
            <s-text>
              Signature saved successfully.
            </s-text>
          </s-box>

          <s-box padding="large">
            <s-text>
              You may now exit this screen.
            </s-text>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  return (
    <s-page heading="New Pickup">
      <s-scroll-box>
        <s-box padding="large">
          <s-text>
            Order: {order.name}
          </s-text>
        </s-box>

        <s-box padding="large">
          <s-text>
            Previous pickups: {pickupHistory.length}
          </s-text>
        </s-box>

        {order.lineItems.nodes.map((item) => {
          const remaining =
            getRemainingQuantity(item);

          return (
            <s-box key={item.id} padding="large">
              <s-stack gap="small">
                <s-text>{item.name}</s-text>

                <s-text>
                  Ordered: {item.quantity}
                </s-text>

                <s-text>
                  Previously picked up:{" "}
                  {getPreviouslyPickedUp(item.id)}
                </s-text>

                <s-text>
                  Remaining: {remaining}
                </s-text>

                {remaining > 0 && (
                  <s-number-field
                    label="Pick up today"
                    value={String(
                      pickupQuantities[item.id] || 0
                    )}
                    min={0}
                    max={remaining}
                    step={1}
                    controls="stepper"
                    onInput={(event) =>
                      updateQuantity(
                        item.id,
                        event.currentTarget.value,
                        remaining
                      )
                    }
                  />
                )}
              </s-stack>
            </s-box>
          );
        })}

        {message && (
          <s-box padding="large">
            <s-text>{message}</s-text>
          </s-box>
        )}

        <s-box padding="large">
          <s-button
            variant="primary"
            onClick={continueFromItems}
          >
            Continue
          </s-button>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}