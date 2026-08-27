import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Action.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.order-details.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/Block.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.order-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
