import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [pickupHistory, setPickupHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const orderId = shopify.order.id;

  useEffect(() => {
    loadPickupHistory();
  }, []);

  async function loadPickupHistory() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/pickup/history?orderId=${encodeURIComponent(orderId)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load pickup history"
        );
      }

      setPickupHistory(data.pickups || []);
    } catch (err) {
      console.error(
        "Pickup history load error:",
        err
      );

      setError(
        err?.message ||
          "Unable to load pickup history"
      );
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return "";
    }

    const date = new Date(dateValue);

    return date.toLocaleString();
  }

  if (loading) {
    return (
      <s-pos-block heading="Pickup Verification">
        <s-box padding="large">
          <s-text>
            Loading pickup history...
          </s-text>
        </s-box>

        <s-button
          slot="secondary-actions"
          onClick={() =>
            shopify.action.presentModal()
          }
        >
          New Pickup
        </s-button>
      </s-pos-block>
    );
  }

  if (error) {
    return (
      <s-pos-block heading="Pickup Verification">
        <s-box padding="large">
          <s-text>
            Unable to load pickup history.
          </s-text>
        </s-box>

        <s-button
          slot="secondary-actions"
          onClick={() =>
            shopify.action.presentModal()
          }
        >
          New Pickup
        </s-button>
      </s-pos-block>
    );
  }

  return (
    <s-pos-block heading="Pickup Verification">

      <s-box padding="large">
        <s-text>
          {pickupHistory.length}{" "}
          {pickupHistory.length === 1
            ? "pickup completed"
            : "pickups completed"}
        </s-text>
      </s-box>

      {pickupHistory.length === 0 && (
        <s-box padding="large">
          <s-text>
            No pickups have been recorded for this order.
          </s-text>
        </s-box>
      )}

      {pickupHistory.map((pickup, index) => (
        <s-box
          key={pickup.id}
          padding="large"
        >
          <s-stack gap="small">

            <s-text>
              Pickup #
              {pickupHistory.length - index}
            </s-text>

            {pickup.pickupDate && (
              <s-text>
                {formatDate(pickup.pickupDate)}
              </s-text>
            )}

            <s-text>
              Pickup person: {pickup.pickupPerson}
            </s-text>

            <s-text>
              Pickup type:{" "}
              {pickup.pickupPersonType === "customer"
                ? "Customer on order"
                : "Authorized person"}
            </s-text>

            <s-text>
              ID:{" "}
              {pickup.idVerified
                ? "Verified"
                : "Not verified"}
            </s-text>

            <s-text>
              Items:
            </s-text>

            {pickup.items.map((item) => (
              <s-text key={item.id}>
                {item.name} — Qty {item.pickupQuantity}
              </s-text>
            ))}

            {pickup.signature?.url ? (
              <>
                <s-text>
                  Signature:
                </s-text>

                <s-box
                  inlineSize="300px"
                  blockSize="200px"
                >
                  <s-image
                    src={pickup.signature.url}
                    inlineSize="fill"
                    objectFit="contain"
                    alt="Customer pickup signature"
                  />
                </s-box>
              </>
            ) : (
              <s-text>
                Signature: Not recorded
              </s-text>
            )}

          </s-stack>
        </s-box>
      ))}

      <s-button
        slot="secondary-actions"
        onClick={() =>
          shopify.action.presentModal()
        }
      >
        New Pickup
      </s-button>

    </s-pos-block>
  );
}