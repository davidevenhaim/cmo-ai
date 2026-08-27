export interface ShopifyProduct {
  id: string;
  title: string;
  price: number;
  tags: string[];
}

export interface ShopifyAdapter {
  getProducts(): Promise<ShopifyProduct[]>;
  getProduct(id: string): Promise<ShopifyProduct>;
}

export class NotImplementedShopifyAdapter implements ShopifyAdapter {
  async getProducts(): Promise<ShopifyProduct[]> {
    throw new Error("ShopifyAdapter not implemented. Wire a concrete adapter.");
  }
  async getProduct(_id: string): Promise<ShopifyProduct> {
    throw new Error("ShopifyAdapter not implemented. Wire a concrete adapter.");
  }
}
