import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

export interface RawShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  availableForSale: boolean;
}

export interface RawShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  productType: string | null;
  tags: string[];
  totalInventory: number;
  variants: { edges: Array<{ node: RawShopifyVariant }> };
  priceRangeV2: {
    minVariantPrice: { amount: string };
    maxVariantPrice: { amount: string };
  };
}

export interface RawShopifyLineItem {
  product: { id: string } | null;
  title: string;
  quantity: number;
  originalUnitPriceSet: { shopMoney: { amount: string } };
}

export interface RawShopifyOrder {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  financialStatus: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  email: string | null;
  checkoutToken: string | null;
  customer: { numberOfOrders: number } | null;
  lineItems: { edges: Array<{ node: RawShopifyLineItem }> };
}

export interface RawShopifyCustomer {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  numberOfOrders: number;
  amountSpent: { amount: string; currencyCode: string };
  emailMarketingConsent: { marketingState: string } | null;
  smsMarketingConsent: { marketingState: string } | null;
  createdAt: string;
}

export interface RawAbandonedCheckoutLineItem {
  title: string;
  quantity: number;
  variant: {
    id: string | null;
    sku: string | null;
    product: { id: string } | null;
  } | null;
  originalTotalSet: { shopMoney: { amount: string; currencyCode: string } };
}

export interface RawShopifyAbandonedCheckout {
  id: string;
  token: string;
  abandonedCheckoutUrl: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lineItems: { edges: Array<{ node: RawAbandonedCheckoutLineItem }> };
}

export interface FetchResult<T> {
  items: T[];
  truncated: boolean;
}

const PAGE_SIZE = 250;

const PRODUCTS_PAGE_QUERY = (cursor?: string) => `
  query {
    products(first: ${PAGE_SIZE}${cursor ? `, after: "${cursor}"` : ""}) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          productType
          tags
          totalInventory
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                availableForSale
              }
            }
          }
          priceRangeV2 {
            minVariantPrice { amount }
            maxVariantPrice { amount }
          }
        }
      }
    }
  }
`;

function buildOrdersPageQuery(
  sinceIso: string,
  untilIso: string,
  cursor?: string,
): string {
  const q = `created_at:>=${sinceIso} AND created_at:<${untilIso}`;
  return `
    query {
      orders(first: ${PAGE_SIZE}${cursor ? `, after: "${cursor}"` : ""}, query: "${q}") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            createdAt
            cancelledAt
            test
            financialStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
            email
            checkoutToken
            customer { numberOfOrders }
            lineItems(first: 50) {
              edges {
                node {
                  product { id }
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }
    }
  `;
}

const CUSTOMERS_PAGE_QUERY = (cursor?: string) => `
  query {
    customers(first: ${PAGE_SIZE}${cursor ? `, after: "${cursor}"` : ""}) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          email
          phone
          firstName
          lastName
          numberOfOrders
          amountSpent { amount currencyCode }
          emailMarketingConsent { marketingState }
          smsMarketingConsent { marketingState }
          createdAt
        }
      }
    }
  }
`;

const ABANDONED_CHECKOUTS_PAGE_QUERY = (cursor?: string) => `
  query {
    abandonedCheckouts(first: ${PAGE_SIZE}${cursor ? `, after: "${cursor}"` : ""}, query: "status:open") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          token
          abandonedCheckoutUrl
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          customer {
            id
            email
            firstName
            lastName
          }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variant {
                  id
                  sku
                  product { id }
                }
                originalTotalSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
`;

// Must include the exact placeholder values shipped in .env.example, so a
// copied-but-unfilled .env is detected as not configured.
const PLACEHOLDER_VALUES = new Set([
  "your-domain.myshopify.com",
  "your-store.myshopify.com",
  "example.myshopify.com",
  "placeholder",
  "your-access-token",
  "shpat_...",
  "SHOPIFY_ACCESS_TOKEN",
]);

@Injectable()
export class ShopifyGraphqlAdapter {
  private readonly logger = new Logger(ShopifyGraphqlAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    const domain = this.config.get<string>("SHOPIFY_SHOP_DOMAIN", "");
    const token = this.config.get<string>("SHOPIFY_ACCESS_TOKEN", "");
    if (!domain || !token) return false;
    if (PLACEHOLDER_VALUES.has(domain) || PLACEHOLDER_VALUES.has(token))
      return false;
    return true;
  }

  async fetchProducts(): Promise<FetchResult<RawShopifyProduct>> {
    const items: RawShopifyProduct[] = [];
    let cursor: string | undefined;
    let truncated = false;

    // Cap at 10 pages (2500 products) to bound request time
    for (let page = 0; page < 10; page++) {
      const data = await this.query<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: Array<{ node: RawShopifyProduct }>;
        };
      }>(PRODUCTS_PAGE_QUERY(cursor));

      for (const edge of data.products.edges) {
        items.push(edge.node);
      }

      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.pageInfo.endCursor;

      if (page === 9) {
        truncated = true;
        this.logger.warn("Product list truncated at 2500 items");
      }
    }

    return { items, truncated };
  }

  async fetchOrders(
    sinceDate: Date,
    untilDate: Date,
  ): Promise<FetchResult<RawShopifyOrder>> {
    const sinceIso = sinceDate.toISOString().split("T")[0];
    const untilIso = untilDate.toISOString().split("T")[0];
    const items: RawShopifyOrder[] = [];
    let cursor: string | undefined;
    let truncated = false;

    for (let page = 0; page < 10; page++) {
      const data = await this.query<{
        orders: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: Array<{ node: RawShopifyOrder }>;
        };
      }>(buildOrdersPageQuery(sinceIso, untilIso, cursor));

      for (const edge of data.orders.edges) {
        items.push(edge.node);
      }

      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;

      if (page === 9) {
        truncated = true;
        this.logger.warn("Order list truncated at 2500 items");
      }
    }

    return { items, truncated };
  }

  async fetchCustomers(): Promise<FetchResult<RawShopifyCustomer>> {
    const items: RawShopifyCustomer[] = [];
    let cursor: string | undefined;
    let truncated = false;

    for (let page = 0; page < 10; page++) {
      const data = await this.query<{
        customers: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: Array<{ node: RawShopifyCustomer }>;
        };
      }>(CUSTOMERS_PAGE_QUERY(cursor));

      for (const edge of data.customers.edges) {
        items.push(edge.node);
      }

      if (!data.customers.pageInfo.hasNextPage) break;
      cursor = data.customers.pageInfo.endCursor;

      if (page === 9) {
        truncated = true;
        this.logger.warn("Customer list truncated at 2500 items");
      }
    }

    return { items, truncated };
  }

  async fetchAbandonedCheckouts(): Promise<
    FetchResult<RawShopifyAbandonedCheckout>
  > {
    const items: RawShopifyAbandonedCheckout[] = [];
    let cursor: string | undefined;
    let truncated = false;

    for (let page = 0; page < 10; page++) {
      const data = await this.query<{
        abandonedCheckouts: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: Array<{ node: RawShopifyAbandonedCheckout }>;
        };
      }>(ABANDONED_CHECKOUTS_PAGE_QUERY(cursor));

      for (const edge of data.abandonedCheckouts.edges) {
        items.push(edge.node);
      }

      if (!data.abandonedCheckouts.pageInfo.hasNextPage) break;
      cursor = data.abandonedCheckouts.pageInfo.endCursor;

      if (page === 9) {
        truncated = true;
        this.logger.warn("Abandoned checkout list truncated at 2500 items");
      }
    }

    return { items, truncated };
  }

  async fetchShopName(): Promise<string> {
    const data = await this.query<{ shop: { name: string } }>(
      `query { shop { name } }`,
    );
    return data.shop.name;
  }

  async fetchCurrencyCode(): Promise<string> {
    const data = await this.query<{
      shop: { currencyCode: string };
    }>(`query { shop { currencyCode } }`);
    return data.shop.currencyCode;
  }

  private async query<T>(query: string): Promise<T> {
    const domain = this.config.get<string>("SHOPIFY_SHOP_DOMAIN");
    const token = this.config.get<string>("SHOPIFY_ACCESS_TOKEN");
    const version = this.config.get<string>("SHOPIFY_API_VERSION") ?? "2024-10";
    const timeoutMs = parseInt(
      this.config.get<string>("SHOPIFY_REQUEST_TIMEOUT_MS") ?? "10000",
    );

    const url = `https://${domain}/admin/api/${version}/graphql.json`;

    const response = await firstValueFrom(
      this.http.post<{ data: T; errors?: unknown[] }>(
        url,
        { query },
        {
          headers: {
            "X-Shopify-Access-Token": token!,
            "Content-Type": "application/json",
          },
          timeout: timeoutMs,
        },
      ),
    );

    if (response.data.errors?.length) {
      throw new Error(
        `Shopify GraphQL error: ${JSON.stringify(response.data.errors)}`,
      );
    }

    return response.data.data;
  }
}
