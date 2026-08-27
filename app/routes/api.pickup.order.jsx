import shopify, { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { sessionToken, cors } = await authenticate.pos(request);

    const url = new URL(request.url);
    const rawOrderId = url.searchParams.get("orderId");

    if (!rawOrderId) {
      return cors(
        Response.json(
          { error: "Missing orderId" },
          { status: 400 }
        )
      );
    }

    const shopUrl = sessionToken.dest;

    if (!shopUrl) {
      return cors(
        Response.json(
          { error: "Unable to determine Shopify store" },
          { status: 401 }
        )
      );
    }

    const shopDomain = new URL(shopUrl).hostname;

    const { admin } = await shopify.unauthenticated.admin(shopDomain);

    const orderId = rawOrderId.startsWith("gid://shopify/Order/")
      ? rawOrderId
      : `gid://shopify/Order/${rawOrderId}`;

    console.log("Loading pickup order:", orderId);

    const response = await admin.graphql(
      `#graphql
        query GetPickupOrder($id: ID!) {
          order(id: $id) {
            id
            name

            lineItems(first: 100) {
              nodes {
                id
                name
                quantity
                variantTitle
                sku

                product {
                  id
                  title
                }

                variant {
                  id
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: orderId,
        },
      }
    );

    const data = await response.json();

    if (data.errors) {
      console.error("GraphQL errors:", data.errors);

      return cors(
        Response.json(
          {
            error: "Unable to load order",
            details: data.errors,
          },
          { status: 500 }
        )
      );
    }

    if (!data.data?.order) {
      return cors(
        Response.json(
          { error: "Order not found" },
          { status: 404 }
        )
      );
    }

    return cors(
      Response.json({
        order: data.data.order,
      })
    );
  } catch (error) {
    console.error("Pickup order error:", error);

    return Response.json(
      {
        error: "Unable to load pickup order",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
};