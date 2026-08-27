import { Injectable } from "@nestjs/common";
import type {
  SearchConsoleProvider,
  SearchConsoleReport,
  SearchConsoleRow,
} from "./search-console.provider";

const FIXTURE_ROWS: SearchConsoleRow[] = [
  {
    query: "tallow moisturizer",
    clicks: 142,
    impressions: 3200,
    ctr: 0.044,
    position: 6.2,
    page: "https://luminesce.co/products/tallow-face-cream",
  },
  {
    query: "tallow balm for face",
    clicks: 87,
    impressions: 2100,
    ctr: 0.041,
    position: 8.4,
    page: "https://luminesce.co/products/tallow-face-cream",
  },
  {
    query: "best tallow skincare",
    clicks: 53,
    impressions: 1800,
    ctr: 0.029,
    position: 11.3,
    page: "https://luminesce.co/blog/why-tallow-skincare",
  },
  {
    query: "tallow skin care benefits",
    clicks: 38,
    impressions: 1450,
    ctr: 0.026,
    position: 13.7,
    page: "https://luminesce.co/blog/tallow-benefits",
  },
  {
    query: "grass fed tallow cream",
    clicks: 29,
    impressions: 980,
    ctr: 0.03,
    position: 9.1,
    page: "https://luminesce.co/products/tallow-face-cream",
  },
  {
    query: "natural tallow lotion",
    clicks: 21,
    impressions: 870,
    ctr: 0.024,
    position: 14.2,
    page: "https://luminesce.co/products/tallow-body-butter",
  },
  {
    query: "whipped tallow balm",
    clicks: 64,
    impressions: 760,
    ctr: 0.084,
    position: 4.3,
    page: "https://luminesce.co/products/whipped-tallow-balm",
  },
  {
    query: "is tallow good for skin",
    clicks: 12,
    impressions: 640,
    ctr: 0.019,
    position: 18.6,
    page: "https://luminesce.co/blog/is-tallow-good-for-skin",
  },
  {
    query: "tallow vs shea butter",
    clicks: 8,
    impressions: 520,
    ctr: 0.015,
    position: 16.9,
    page: "https://luminesce.co/blog/tallow-vs-shea-butter",
  },
  {
    query: "luminesce tallow cream",
    clicks: 98,
    impressions: 420,
    ctr: 0.233,
    position: 1.8,
    page: "https://luminesce.co/products/tallow-face-cream",
  },
];

@Injectable()
export class MockSearchConsoleProvider implements SearchConsoleProvider {
  readonly providerName = "mock-search-console";

  private readonly rows: SearchConsoleRow[];

  constructor(rows?: SearchConsoleRow[]) {
    this.rows = rows ?? FIXTURE_ROWS;
  }

  isConfigured(): boolean {
    // Documents that real credentials are not present.
    return false;
  }

  async getQueryReport(params: {
    siteUrl: string;
    startDate: string;
    endDate: string;
    dimensions?: string[];
    rowLimit?: number;
  }): Promise<SearchConsoleReport> {
    const limit = params.rowLimit ?? 1000;
    return {
      rows: this.rows.slice(0, limit),
      period: `${params.startDate} to ${params.endDate}`,
      dataDelay: 3,
      evidenceStatus: "MOCK",
    };
  }
}
