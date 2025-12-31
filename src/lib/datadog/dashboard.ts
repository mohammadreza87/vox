/**
 * Datadog Dashboard Configuration for LLM Observability
 *
 * This defines a comprehensive dashboard for monitoring:
 * - LLM performance metrics
 * - Token usage and costs
 * - Error rates and availability
 * - Security threats
 * - User activity
 */

export interface DashboardWidget {
  id?: number;
  definition: {
    type: string;
    title?: string;
    title_size?: string;
    title_align?: string;
    show_legend?: boolean;
    legend_layout?: string;
    legend_columns?: string[];
    time?: { live_span?: string };
    requests?: Array<{
      formulas?: Array<{ formula: string; alias?: string }>;
      queries?: Array<{
        name?: string;
        data_source: string;
        query: string;
        aggregator?: string;
      }>;
      response_format?: string;
      style?: { palette?: string; line_type?: string; line_width?: string };
      display_type?: string;
    }>;
    markers?: Array<{
      value: string;
      display_type: string;
      label?: string;
    }>;
    yaxis?: { include_zero?: boolean; min?: string; max?: string };
    custom_links?: Array<{ label: string; link: string }>;
    text?: string;
    font_size?: string;
    text_align?: string;
    background_color?: string;
  };
  layout?: { x: number; y: number; width: number; height: number };
}

export interface DashboardDefinition {
  title: string;
  description: string;
  widgets: DashboardWidget[];
  layout_type: 'ordered' | 'free';
  notify_list?: string[];
  reflow_type?: string;
  template_variables?: Array<{
    name: string;
    prefix?: string;
    default: string;
    available_values?: string[];
  }>;
}

/**
 * LLM Observability Dashboard Definition
 */
export const LLM_OBSERVABILITY_DASHBOARD: DashboardDefinition = {
  title: 'Vox LLM Observability Dashboard',
  description: 'Comprehensive monitoring for LLM operations in the Vox voice AI application',
  layout_type: 'ordered',
  reflow_type: 'fixed',
  template_variables: [
    {
      name: 'provider',
      prefix: 'provider',
      default: '*',
      available_values: ['gemini', 'claude', 'openai', 'deepseek'],
    },
    {
      name: 'model',
      prefix: 'model',
      default: '*',
    },
    {
      name: 'env',
      prefix: 'env',
      default: 'production',
      available_values: ['production', 'staging', 'development'],
    },
  ],
  widgets: [
    // === Header Section ===
    {
      definition: {
        type: 'note',
        content: '# 🤖 LLM Observability Dashboard\n\nReal-time monitoring of AI operations, performance, costs, and security.',
        background_color: 'blue',
        font_size: '16',
        text_align: 'center',
        vertical_align: 'center',
        show_tick: false,
        tick_pos: '50%',
        tick_edge: 'bottom',
        has_padding: true,
      },
      layout: { x: 0, y: 0, width: 12, height: 1 },
    } as DashboardWidget,

    // === Key Metrics Row ===
    {
      definition: {
        type: 'query_value',
        title: 'Total LLM Requests (24h)',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.requests{$provider,$model,$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        autoscale: true,
        precision: 0,
      },
      layout: { x: 0, y: 1, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Avg Latency (ms)',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'avg:vox.llm.latency_ms{$provider,$model,$env}',
                aggregator: 'avg',
              },
            ],
            response_format: 'scalar',
          },
        ],
        autoscale: true,
        precision: 0,
        custom_unit: 'ms',
      },
      layout: { x: 3, y: 1, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Error Rate',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [
              {
                formula: '(query2 / query1) * 100',
                alias: 'Error Rate %',
              },
            ],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.requests{$provider,$model,$env}.as_count()',
                aggregator: 'sum',
              },
              {
                name: 'query2',
                data_source: 'metrics',
                query: 'sum:vox.llm.errors{$provider,$model,$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 2,
        custom_unit: '%',
      },
      layout: { x: 6, y: 1, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Estimated Cost (24h)',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1 / 1000000', alias: 'Cost USD' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.cost_usd{$provider,$model,$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 2,
        custom_unit: 'USD',
      },
      layout: { x: 9, y: 1, width: 3, height: 2 },
    } as DashboardWidget,

    // === Performance Section ===
    {
      definition: {
        type: 'note',
        content: '## 📊 Performance Metrics',
        background_color: 'gray',
        font_size: '14',
        text_align: 'left',
        vertical_align: 'center',
        show_tick: false,
        has_padding: true,
      },
      layout: { x: 0, y: 3, width: 12, height: 1 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'LLM Latency Over Time',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        legend_columns: ['avg', 'max', 'value'],
        requests: [
          {
            formulas: [
              { formula: 'query1', alias: 'Avg Latency' },
              { formula: 'query2', alias: 'P95 Latency' },
              { formula: 'query3', alias: 'P99 Latency' },
            ],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'avg:vox.llm.latency_ms{$provider,$model,$env}',
              },
              {
                name: 'query2',
                data_source: 'metrics',
                query: 'p95:vox.llm.latency_ms{$provider,$model,$env}',
              },
              {
                name: 'query3',
                data_source: 'metrics',
                query: 'p99:vox.llm.latency_ms{$provider,$model,$env}',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'dog_classic', line_type: 'solid', line_width: 'normal' },
            display_type: 'line',
          },
        ],
        yaxis: { include_zero: true, min: '0' },
        markers: [
          { value: 'y = 10000', display_type: 'error dashed', label: 'SLA Threshold' },
        ],
      },
      layout: { x: 0, y: 4, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Time to First Token',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Time to First Token' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'avg:vox.llm.time_to_first_token_ms{$provider,$model,$env} by {provider}',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'cool', line_type: 'solid', line_width: 'normal' },
            display_type: 'line',
          },
        ],
        yaxis: { include_zero: true, min: '0' },
      },
      layout: { x: 6, y: 4, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Requests by Provider',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Requests' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.requests{$provider,$model,$env} by {provider}.as_count()',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'semantic' },
            display_type: 'bars',
          },
        ],
      },
      layout: { x: 0, y: 7, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Token Throughput (tokens/sec)',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Throughput' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'avg:vox.llm.tokens_per_second{$provider,$model,$env} by {model}',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'warm' },
            display_type: 'line',
          },
        ],
      },
      layout: { x: 6, y: 7, width: 6, height: 3 },
    } as DashboardWidget,

    // === Token Usage Section ===
    {
      definition: {
        type: 'note',
        content: '## 🪙 Token Usage & Costs',
        background_color: 'gray',
        font_size: '14',
        text_align: 'left',
        vertical_align: 'center',
        show_tick: false,
        has_padding: true,
      },
      layout: { x: 0, y: 10, width: 12, height: 1 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Token Usage Over Time',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [
              { formula: 'query1', alias: 'Prompt Tokens' },
              { formula: 'query2', alias: 'Completion Tokens' },
            ],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.tokens.prompt{$provider,$model,$env}.as_count()',
              },
              {
                name: 'query2',
                data_source: 'metrics',
                query: 'sum:vox.llm.tokens.completion{$provider,$model,$env}.as_count()',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'green' },
            display_type: 'area',
          },
        ],
      },
      layout: { x: 0, y: 11, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Cost Over Time (USD)',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [{ formula: 'cumsum(query1 / 1000000)', alias: 'Cumulative Cost' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.cost_usd{$provider,$model,$env} by {provider}.as_count()',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'orange' },
            display_type: 'line',
          },
        ],
      },
      layout: { x: 6, y: 11, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'toplist',
        title: 'Cost by Model',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1 / 1000000', alias: 'Cost USD' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.cost_usd{$provider,$env} by {model}.as_count()',
              },
            ],
            response_format: 'scalar',
          },
        ],
      },
      layout: { x: 0, y: 14, width: 4, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'toplist',
        title: 'Tokens by Model',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Total Tokens' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.tokens.total{$provider,$env} by {model}.as_count()',
              },
            ],
            response_format: 'scalar',
          },
        ],
      },
      layout: { x: 4, y: 14, width: 4, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'toplist',
        title: 'Requests by Model',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Requests' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.requests{$provider,$env} by {model}.as_count()',
              },
            ],
            response_format: 'scalar',
          },
        ],
      },
      layout: { x: 8, y: 14, width: 4, height: 3 },
    } as DashboardWidget,

    // === Security Section ===
    {
      definition: {
        type: 'note',
        content: '## 🔒 Security Monitoring',
        background_color: 'gray',
        font_size: '14',
        text_align: 'left',
        vertical_align: 'center',
        show_tick: false,
        has_padding: true,
      },
      layout: { x: 0, y: 17, width: 12, height: 1 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Prompt Injection Attempts',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.prompt_injection{$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 0,
        conditional_formats: [
          { comparator: '>', value: 0, palette: 'white_on_red' },
          { comparator: '<=', value: 0, palette: 'white_on_green' },
        ],
      },
      layout: { x: 0, y: 18, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Data Exfiltration Attempts',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.data_exfiltration{$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 0,
        conditional_formats: [
          { comparator: '>', value: 0, palette: 'white_on_red' },
          { comparator: '<=', value: 0, palette: 'white_on_green' },
        ],
      },
      layout: { x: 3, y: 18, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'PII Exposures',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.pii_exposure{$env}.as_count()',
                aggregator: 'sum',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 0,
        conditional_formats: [
          { comparator: '>', value: 5, palette: 'white_on_yellow' },
          { comparator: '<=', value: 5, palette: 'white_on_green' },
        ],
      },
      layout: { x: 6, y: 18, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'query_value',
        title: 'Security Risk Score',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'avg:vox.security.risk_score{$env}',
                aggregator: 'avg',
              },
            ],
            response_format: 'scalar',
          },
        ],
        precision: 0,
        custom_unit: '/100',
        conditional_formats: [
          { comparator: '>', value: 70, palette: 'white_on_red' },
          { comparator: '>', value: 30, palette: 'white_on_yellow' },
          { comparator: '<=', value: 30, palette: 'white_on_green' },
        ],
      },
      layout: { x: 9, y: 18, width: 3, height: 2 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Security Threats Over Time',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [
              { formula: 'query1', alias: 'Prompt Injection' },
              { formula: 'query2', alias: 'Data Exfiltration' },
              { formula: 'query3', alias: 'PII Exposure' },
            ],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.prompt_injection{$env}.as_count()',
              },
              {
                name: 'query2',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.data_exfiltration{$env}.as_count()',
              },
              {
                name: 'query3',
                data_source: 'metrics',
                query: 'sum:vox.security.threat.pii_exposure{$env}.as_count()',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'red' },
            display_type: 'bars',
          },
        ],
      },
      layout: { x: 0, y: 20, width: 12, height: 3 },
    } as DashboardWidget,

    // === Errors Section ===
    {
      definition: {
        type: 'note',
        content: '## ⚠️ Errors & Incidents',
        background_color: 'gray',
        font_size: '14',
        text_align: 'left',
        vertical_align: 'center',
        show_tick: false,
        has_padding: true,
      },
      layout: { x: 0, y: 23, width: 12, height: 1 },
    } as DashboardWidget,
    {
      definition: {
        type: 'timeseries',
        title: 'Error Rate by Provider',
        title_size: '16',
        title_align: 'left',
        show_legend: true,
        legend_layout: 'auto',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Errors' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.errors{$model,$env} by {provider}.as_count()',
              },
            ],
            response_format: 'timeseries',
            style: { palette: 'warm' },
            display_type: 'bars',
          },
        ],
      },
      layout: { x: 0, y: 24, width: 6, height: 3 },
    } as DashboardWidget,
    {
      definition: {
        type: 'toplist',
        title: 'Top Errors by Type',
        title_size: '16',
        title_align: 'left',
        requests: [
          {
            formulas: [{ formula: 'query1', alias: 'Count' }],
            queries: [
              {
                name: 'query1',
                data_source: 'metrics',
                query: 'sum:vox.llm.errors{$env} by {error_type}.as_count()',
              },
            ],
            response_format: 'scalar',
          },
        ],
      },
      layout: { x: 6, y: 24, width: 6, height: 3 },
    } as DashboardWidget,
  ],
};

/**
 * Export dashboard as JSON for Datadog API import
 */
export function getDashboardJSON(): string {
  return JSON.stringify(LLM_OBSERVABILITY_DASHBOARD, null, 2);
}

/**
 * Create dashboard via Datadog API
 */
export async function createDashboard(apiKey: string, appKey: string, site: string = 'datadoghq.com'): Promise<string | null> {
  try {
    const response = await fetch(`https://api.${site}/api/v1/dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
      },
      body: JSON.stringify(LLM_OBSERVABILITY_DASHBOARD),
    });

    if (response.ok) {
      const data = await response.json();
      return data.url || data.id;
    } else {
      console.error('[Datadog] Failed to create dashboard:', response.statusText);
      return null;
    }
  } catch (error) {
    console.error('[Datadog] Error creating dashboard:', error);
    return null;
  }
}

export default { LLM_OBSERVABILITY_DASHBOARD, getDashboardJSON, createDashboard };
