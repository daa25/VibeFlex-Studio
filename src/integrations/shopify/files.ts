// Re-hosts artwork to Shopify Files, so the auto-create pipeline always has a
// permanent, publicly-fetchable image URL for Printify uploads and Shopify
// media — regardless of whether Supabase Storage is configured (the local
// disk fallback in storage.ts is ephemeral and, if relative, not directly
// fetchable by an external service like Printify).

import { adminGraphql, throwOnUserErrors, type UserError } from "./admin-client";

const FILE_CREATE = `
mutation UploadArtwork($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus }
    userErrors { field message }
  }
}`;

const FILE_STATUS = `
query FileStatus($id: ID!) {
  node(id: $id) {
    ... on MediaImage {
      fileStatus
      image { url }
    }
  }
}`;

export class ShopifyFileProcessingError extends Error {}

/**
 * originalSource must already be a public https URL (Shopify fetches it
 * itself). Polls until the file finishes processing, up to ~20s.
 */
export async function rehostArtworkToShopify(params: {
  sourceUrl: string;
  filename: string;
  alt: string;
}): Promise<string> {
  const created = await adminGraphql<{
    fileCreate: { files: { id: string; fileStatus: string }[]; userErrors: UserError[] };
  }>(FILE_CREATE, {
    files: [
      {
        originalSource: params.sourceUrl,
        filename: params.filename,
        contentType: "IMAGE",
        alt: params.alt,
        duplicateResolutionMode: "APPEND_UUID",
      },
    ],
  });
  throwOnUserErrors("Shopify fileCreate", created.fileCreate.userErrors);

  const file = created.fileCreate.files[0];
  if (!file) throw new ShopifyFileProcessingError("Shopify fileCreate returned no file.");

  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await adminGraphql<{
      node: { fileStatus: string; image: { url: string } | null } | null;
    }>(FILE_STATUS, { id: file.id });

    if (result.node?.fileStatus === "READY" && result.node.image?.url) {
      return result.node.image.url;
    }
    if (result.node?.fileStatus === "FAILED") {
      throw new ShopifyFileProcessingError(`Shopify failed to process the uploaded artwork (file ${file.id}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new ShopifyFileProcessingError(
    `Shopify did not finish processing the uploaded artwork (file ${file.id}) in time.`
  );
}
