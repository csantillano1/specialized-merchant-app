import shopify, { authenticate } from "../shopify.server";

async function getPickupDefinition(admin) {
  const response = await admin.graphql(
    `#graphql
      query PickupDefinition {
        metaobjectDefinitionByType(type: "$app:pickup_record") {
          id
          fieldDefinitions {
            key
          }
        }
      }
    `
  );

  const data = await response.json();

  return data.data?.metaobjectDefinitionByType || null;
}

async function ensureSignatureField(admin) {
  const definition = await getPickupDefinition(admin);

  if (!definition) {
    throw new Error(
      "Pickup Record definition was not found."
    );
  }

  const hasSignatureField =
    definition.fieldDefinitions?.some(
      (field) => field.key === "signature_file"
    );

  if (hasSignatureField) {
    console.log("Signature field already exists.");
    return;
  }

  console.log("Creating signature field...");

  const response = await admin.graphql(
    `#graphql
      mutation UpdatePickupDefinition(
        $id: ID!
        $definition: MetaobjectDefinitionUpdateInput!
      ) {
        metaobjectDefinitionUpdate(
          id: $id
          definition: $definition
        ) {
          metaobjectDefinition {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        id: definition.id,
        definition: {
          fieldDefinitions: [
            {
              create: {
                name: "Signature",
                key: "signature_file",
                type: "file_reference",
              },
            },
          ],
        },
      },
    }
  );

  const data = await response.json();

  const errors =
    data.data?.metaobjectDefinitionUpdate?.userErrors || [];

  if (errors.length > 0) {
    throw new Error(
      errors
        .map((error) => error.message)
        .join(", ")
    );
  }

  console.log("Signature field created.");
}

function base64ToBuffer(base64) {
  return Buffer.from(base64, "base64");
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForFileReady(admin, fileId) {
  console.log(
    "Waiting for signature file to become READY:",
    fileId
  );

  for (let attempt = 1; attempt <= 15; attempt++) {
    const response = await admin.graphql(
      `#graphql
        query SignatureFileStatus($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              id
              fileStatus
            }
          }
        }
      `,
      {
        variables: {
          id: fileId,
        },
      }
    );

    const data = await response.json();

    const status =
      data.data?.node?.fileStatus;

    console.log(
      `Signature file status attempt ${attempt}:`,
      status
    );

    if (status === "READY") {
      console.log("Signature file is READY.");
      return;
    }

    if (status === "FAILED") {
      throw new Error(
        "Shopify failed to process the signature image."
      );
    }

    await wait(750);
  }

  throw new Error(
    "Signature image is still processing. Please try saving again."
  );
}

async function uploadSignature(admin, signature) {
  if (!signature?.base64) {
    throw new Error(
      "Signature image data is missing."
    );
  }

  const mimeType =
    signature.type || "image/jpeg";

  const extension =
    mimeType === "image/png"
      ? "png"
      : "jpg";

  const filename =
    `pickup-signature-${Date.now()}.${extension}`;

  console.log(
    "Creating staged signature upload:",
    filename
  );

  const stagedResponse = await admin.graphql(
    `#graphql
      mutation StageSignatureUpload(
        $input: [StagedUploadInput!]!
      ) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        input: [
          {
            filename,
            mimeType,
            resource: "IMAGE",
            httpMethod: "POST",
          },
        ],
      },
    }
  );

  const stagedData =
    await stagedResponse.json();

  const stagedErrors =
    stagedData.data?.stagedUploadsCreate
      ?.userErrors || [];

  if (stagedErrors.length > 0) {
    throw new Error(
      stagedErrors
        .map((error) => error.message)
        .join(", ")
    );
  }

  const target =
    stagedData.data?.stagedUploadsCreate
      ?.stagedTargets?.[0];

  if (!target) {
    throw new Error(
      "Shopify did not return a signature upload target."
    );
  }

  console.log(
    "Staged signature upload created."
  );

  const form = new FormData();

  target.parameters.forEach((parameter) => {
    form.append(
      parameter.name,
      parameter.value
    );
  });

  const buffer =
    base64ToBuffer(signature.base64);

  const blob = new Blob(
    [buffer],
    {
      type: mimeType,
    }
  );

  form.append(
    "file",
    blob,
    filename
  );

  console.log(
    "Uploading signature image..."
  );

  const uploadResponse =
    await fetch(target.url, {
      method: "POST",
      body: form,
    });

  if (!uploadResponse.ok) {
    const uploadText =
      await uploadResponse.text();

    console.error(
      "Signature upload response:",
      uploadResponse.status,
      uploadText
    );

    throw new Error(
      "Unable to upload signature image."
    );
  }

  console.log(
    "Signature image uploaded to staged storage."
  );

  const fileResponse = await admin.graphql(
    `#graphql
      mutation CreateSignatureFile(
        $files: [FileCreateInput!]!
      ) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        files: [
          {
            originalSource:
              target.resourceUrl,
            contentType: "IMAGE",
            alt:
              "Customer pickup signature",
          },
        ],
      },
    }
  );

  const fileData =
    await fileResponse.json();

  const fileErrors =
    fileData.data?.fileCreate
      ?.userErrors || [];

  if (fileErrors.length > 0) {
    throw new Error(
      fileErrors
        .map((error) => error.message)
        .join(", ")
    );
  }

  const createdFile =
    fileData.data?.fileCreate?.files?.[0];

  if (!createdFile?.id) {
    throw new Error(
      "Signature file was created without a file ID."
    );
  }

  console.log(
    "Shopify signature file created:",
    createdFile.id,
    "status:",
    createdFile.fileStatus
  );

  if (
    createdFile.fileStatus !== "READY"
  ) {
    await waitForFileReady(
      admin,
      createdFile.id
    );
  }

  return createdFile.id;
}

export const action = async ({ request }) => {
  let applyCors = (response) => response;

  try {
    console.log(
      "Beginning signed pickup save..."
    );

    const auth =
      await authenticate.pos(request);

    const {
      sessionToken,
      cors,
    } = auth;

    applyCors = cors;

    const shopUrl =
      sessionToken.dest;

    if (!shopUrl) {
      return applyCors(
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

    const body =
      await request.json();

    if (!body.orderId) {
      return applyCors(
        Response.json(
          {
            error:
              "Missing order ID",
          },
          { status: 400 }
        )
      );
    }

    if (!body.pickupPersonName) {
      return applyCors(
        Response.json(
          {
            error:
              "Missing pickup person's name",
          },
          { status: 400 }
        )
      );
    }

    if (
      !body.items ||
      body.items.length === 0
    ) {
      return applyCors(
        Response.json(
          {
            error:
              "No pickup items selected",
          },
          { status: 400 }
        )
      );
    }

    if (!body.signature?.base64) {
      return applyCors(
        Response.json(
          {
            error:
              "A signature image is required",
          },
          { status: 400 }
        )
      );
    }

    console.log(
      "Pickup request validated."
    );

    await ensureSignatureField(admin);

    console.log(
      "Uploading signature..."
    );

    const signatureFileId =
      await uploadSignature(
        admin,
        body.signature
      );

    console.log(
      "Signature ready:",
      signatureFileId
    );

    const rawOrderId =
      String(body.orderId);

    const orderId =
      rawOrderId.startsWith(
        "gid://shopify/Order/"
      )
        ? rawOrderId
        : `gid://shopify/Order/${rawOrderId}`;

    const pickupDate =
      new Date().toISOString();

    console.log(
      "Saving signed pickup for order:",
      orderId
    );

    const response =
      await admin.graphql(
        `#graphql
          mutation CreatePickup(
            $metaobject: MetaobjectCreateInput!
          ) {
            metaobjectCreate(
              metaobject: $metaobject
            ) {
              metaobject {
                id
                handle
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            metaobject: {
              type:
                "$app:pickup_record",
              fields: [
                {
                  key: "order_id",
                  value: orderId,
                },
                {
                  key: "order_name",
                  value:
                    body.orderName ||
                    "",
                },
                {
                  key: "pickup_person",
                  value:
                    body.pickupPersonName,
                },
                {
                  key:
                    "pickup_person_type",
                  value:
                    body.pickupPersonType ||
                    "",
                },
                {
                  key:
                    "id_verified",
                  value:
                    body.idVerified ===
                    "yes"
                      ? "true"
                      : "false",
                },
                {
                  key: "items",
                  value:
                    JSON.stringify(
                      body.items
                    ),
                },
                {
                  key:
                    "pickup_date",
                  value:
                    pickupDate,
                },
                {
                  key:
                    "signature_file",
                  value:
                    signatureFileId,
                },
              ],
            },
          },
        }
      );

    console.log(
      "Pickup metaobject mutation returned."
    );

    const data =
      await response.json();

    const errors =
      data.data
        ?.metaobjectCreate
        ?.userErrors || [];

    if (errors.length > 0) {
      console.error(
        "Metaobject errors:",
        errors
      );

      return applyCors(
        Response.json(
          {
            error: errors
              .map(
                (error) =>
                  error.message
              )
              .join(", "),
          },
          { status: 400 }
        )
      );
    }

    const pickupId =
      data.data
        ?.metaobjectCreate
        ?.metaobject?.id;

    if (!pickupId) {
      throw new Error(
        "Shopify did not return a pickup record ID."
      );
    }

    console.log(
      "SIGNED PICKUP SAVED SUCCESSFULLY:",
      pickupId
    );

    return applyCors(
      Response.json({
        success: true,
        pickupId,
        pickupDate,
        signatureFileId,
      })
    );
  } catch (error) {
    console.error(
      "SIGNED PICKUP SAVE ERROR:",
      error
    );

    return applyCors(
      Response.json(
        {
          success: false,
          error:
            error?.message ||
            "Unable to save pickup",
        },
        { status: 500 }
      )
    );
  }
};