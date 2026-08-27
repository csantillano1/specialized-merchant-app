import shopify, { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { sessionToken, cors } =
      await authenticate.pos(request);

    const url = new URL(request.url);
    const rawOrderId =
      url.searchParams.get("orderId");

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
          {
            error:
              "Unable to determine Shopify store",
          },
          { status: 401 }
        )
      );
    }

    const shopDomain =
      new URL(shopUrl).hostname;

    const { admin } =
      await shopify.unauthenticated.admin(
        shopDomain
      );

    const orderId =
      String(rawOrderId).startsWith(
        "gid://shopify/Order/"
      )
        ? String(rawOrderId)
        : `gid://shopify/Order/${rawOrderId}`;

    const response = await admin.graphql(
      `#graphql
        query PickupHistory {
          metaobjects(
            type: "$app:pickup_record"
            first: 100
          ) {
            nodes {
              id
              handle

              fields {
                key
                value

                reference {
                  __typename

                  ... on MediaImage {
                    id
                    fileStatus
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      `
    );

    const data = await response.json();

    if (data.errors) {
      console.error(
        "Pickup history GraphQL errors:",
        data.errors
      );

      return cors(
        Response.json(
          {
            error:
              "Unable to load pickup history",
          },
          { status: 500 }
        )
      );
    }

    const records =
      data.data?.metaobjects?.nodes || [];

    const pickups = records
      .map((record) => {
        const fields = {};

        record.fields.forEach(
          (field) => {
            fields[field.key] = {
              value: field.value,
              reference:
                field.reference || null,
            };
          }
        );

        let items = [];

        try {
          items =
            fields.items?.value
              ? JSON.parse(
                  fields.items.value
                )
              : [];
        } catch (error) {
          console.error(
            "Unable to parse pickup items:",
            error
          );
        }

        const signatureReference =
          fields.signature_file
            ?.reference;

        const signatureUrl =
          signatureReference
            ?.__typename ===
            "MediaImage"
            ? signatureReference
                .image?.url || null
            : null;

        return {
          id: record.id,
          handle: record.handle,

          orderId:
            fields.order_id?.value ||
            "",

          orderName:
            fields.order_name?.value ||
            "",

          pickupPerson:
            fields.pickup_person?.value ||
            "",

          pickupPersonType:
            fields.pickup_person_type
              ?.value || "",

          idVerified:
            fields.id_verified?.value ===
            "true",

          pickupDate:
            fields.pickup_date?.value ||
            "",

          items,

          signature: {
            saved: Boolean(
              fields.signature_file
                ?.value
            ),

            fileId:
              fields.signature_file
                ?.value || null,

            fileStatus:
              signatureReference
                ?.fileStatus || null,

            url: signatureUrl,
          },
        };
      })
      .filter(
        (pickup) =>
          pickup.orderId === orderId
      )
      .sort((a, b) => {
        return (
          new Date(
            b.pickupDate
          ).getTime() -
          new Date(
            a.pickupDate
          ).getTime()
        );
      });

    return cors(
      Response.json({
        orderId,
        count: pickups.length,
        pickups,
      })
    );
  } catch (error) {
    console.error(
      "Pickup history error:",
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          "Unable to load pickup history",
      },
      { status: 500 }
    );
  }
};