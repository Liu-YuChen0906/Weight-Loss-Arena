<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, AriaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Member } from '../api/client'
echarts.use([LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer])
const props = defineProps<{ members: Member[]; dimension: string; personal?: boolean }>()
const element = ref<HTMLElement>()
let chart: echarts.ECharts | undefined
let resize: ResizeObserver | undefined
const colors = [
  '#CF4938',
  '#6B80C6',
  '#B96491',
  '#9471BC',
  '#32978F',
  '#C18A35',
  '#628D50',
  '#5C91B2',
]
const noRecords = computed(() => props.members.every((m) => !m.summary?.rows.length))
function draw() {
  if (!chart) return
  const dimension = noRecords.value ? 'weight' : props.dimension
  const dates = props.members.flatMap((m) =>
    m.points.map((p) => Date.parse(`${p.date}T00:00:00+08:00`)),
  )
  const min = dates.length ? Math.min(...dates) : Date.now()
  const max = dates.length ? Math.max(...dates) : min
  const padding = max === min ? 86400000 : (max - min) * 0.08
  chart.setOption(
    {
      animationDuration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350,
      aria: {
        enabled: true,
        label: { description: '真实记录按日期显示；起始体重是准备时填写的展示点。' },
      },
      grid: { top: 25, right: 18, bottom: 35, left: 42 },
      tooltip: props.personal
        ? {
            renderMode: 'richText',
            trigger: 'item',
            formatter: (p: any) =>
              `${p.seriesName}\n${p.data[2]} · ${Number(p.data[1]).toFixed(2)} ${dimension === 'percent' ? '%' : 'kg'}${p.data[3] === 'preparation' ? '\n起始体重·准备时填写' : ''}`,
          }
        : { show: false },
      xAxis: {
        type: 'time',
        min: min - padding,
        max: max + padding,
        axisLabel: {
          color: '#948e95',
          formatter: (v: number) =>
            new Intl.DateTimeFormat('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              timeZone: 'Asia/Shanghai',
            }).format(v),
          hideOverlap: true,
        },
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        minInterval: 0.01,
        splitNumber: 3,
        axisLabel: {
          color: '#948e95',
          formatter: (v: number) => `${Number(v.toFixed(2))}${dimension === 'percent' ? '%' : ''}`,
        },
        splitLine: { lineStyle: { color: '#efedef', type: 'dashed' } },
      },
      series: props.members.map((m, i) => ({
        name: m.nickname,
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { width: 2.5 },
        itemStyle: { color: colors[i % colors.length], borderWidth: 2, borderColor: '#fff' },
        data: m.points
          .filter((p) => dimension === 'weight' || p.source !== 'preparation')
          .map((p) => [
            Date.parse(`${p.date}T00:00:00+08:00`),
            p[dimension as 'weight' | 'change' | 'percent'],
            p.date,
            p.source,
          ]),
        markLine:
          dimension !== 'weight'
            ? {
                silent: true,
                symbol: 'none',
                data: [{ yAxis: 0 }],
                label: { show: false },
                lineStyle: { color: '#c7c1c7' },
              }
            : undefined,
      })),
    },
    true,
  )
}
onMounted(() => {
  chart = echarts.init(element.value!)
  resize = new ResizeObserver(() => chart?.resize())
  resize.observe(element.value!)
  draw()
})
watch(() => [props.members, props.dimension], draw, { deep: true })
onBeforeUnmount(() => {
  resize?.disconnect()
  chart?.dispose()
})
</script>
<template>
  <div class="trend-wrap">
    <p
      v-if="noRecords"
      class="chart-note"
    >
      起点已就位
      <span>· 起始体重，准备时填写</span>
    </p>
    <div
      ref="element"
      class="trend"
      role="img"
      aria-label="体重记录图表"
    ></div>
    <details
      v-if="personal"
      class="accessible-points"
    >
      <summary>查看图表数据</summary>
      <p
        v-for="point in members[0]?.points"
        :key="point.date"
        tabindex="0"
      >
        {{ point.date }} · {{ point.weight.toFixed(2) }} kg
        {{ point.source === 'preparation' ? '起始体重·准备时填写' : '' }}
      </p>
    </details>
  </div>
</template>
