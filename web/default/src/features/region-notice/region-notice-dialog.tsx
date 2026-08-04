/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { CheckCircle2, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

import type { RegionModelEntry } from './api'
import { useRegionNotice } from './use-region-notice'

type ModelListProps = {
  models: RegionModelEntry[]
  variant: 'available' | 'restricted'
  emptyText: string
}

function ModelList({ models, variant, emptyText }: ModelListProps) {
  if (models.length === 0) {
    return (
      <p className='text-muted-foreground py-6 text-center text-sm'>
        {emptyText}
      </p>
    )
  }

  return (
    <ul className='space-y-1.5'>
      {models.map((item) => (
        <li
          key={item.model_name}
          className='flex flex-col gap-1 rounded-md border px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-3'
        >
          <span
            className={
              variant === 'available'
                ? 'font-mono text-xs break-all sm:text-sm'
                : 'text-muted-foreground font-mono text-xs break-all sm:text-sm'
            }
          >
            {item.model_name}
          </span>
          <span className='flex flex-wrap gap-1 sm:justify-end'>
            {item.groups.map((group) => (
              <Badge
                key={group}
                variant={variant === 'available' ? 'secondary' : 'outline'}
                className='text-[11px]'
              >
                {group}
              </Badge>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 大陆访客的模型可见性提示弹窗。
 * 同时列出当前可用模型与仅海外可访问的模型，说明差异原因。
 */
export function RegionNoticeDialog() {
  const { notice, open, close } = useRegionNotice()
  const [keyword, setKeyword] = useState('')
  const [dontRemindToday, setDontRemindToday] = useState(false)

  const filtered = useMemo(() => {
    if (!notice) return { available: [], overseas: [] }
    const needle = keyword.trim().toLowerCase()
    const match = (item: RegionModelEntry) =>
      needle === '' || item.model_name.toLowerCase().includes(needle)
    return {
      available: notice.available_models.filter(match),
      overseas: notice.overseas_only_models.filter(match),
    }
  }, [notice, keyword])

  if (!notice) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 点遮罩或按 Esc 关闭时，同样尊重勾选状态。
        if (!next) close(dontRemindToday)
      }}
      title='当前地区的模型可用范围'
      description='检测到你正在中国大陆网络环境访问。下面列出你现在可直接使用的模型，以及仅面向海外网络开放的模型。'
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-3xl'
      titleClassName='text-base sm:text-lg'
      descriptionClassName='text-xs sm:text-sm'
      footer={
        <div className='flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-2'>
            <Checkbox
              id='region-notice-snooze'
              checked={dontRemindToday}
              onCheckedChange={(checked) =>
                setDontRemindToday(checked === true)
              }
            />
            <Label
              htmlFor='region-notice-snooze'
              className='text-muted-foreground text-sm font-normal'
            >
              本日不再提醒
            </Label>
          </div>
          <Button
            onClick={() => close(dontRemindToday)}
            className='w-full sm:w-auto'
          >
            我已了解
          </Button>
        </div>
      }
    >
      <div className='space-y-4'>
        {/* 窄屏也保持三列并排，避免纵向堆叠挤压下方模型列表 */}
        <div className='grid grid-cols-3 gap-2 sm:gap-3'>
          <div className='rounded-lg border p-2 sm:p-3'>
            <p className='text-muted-foreground text-[11px] sm:text-xs'>
              当前可用
            </p>
            <p className='text-lg font-semibold tabular-nums sm:text-2xl'>
              {notice.available_model_count}
            </p>
          </div>
          <div className='rounded-lg border p-2 sm:p-3'>
            <p className='text-muted-foreground text-[11px] sm:text-xs'>
              仅海外可用
            </p>
            <p className='text-lg font-semibold tabular-nums sm:text-2xl'>
              {notice.overseas_model_count}
            </p>
          </div>
          <div className='rounded-lg border p-2 sm:p-3'>
            <p className='text-muted-foreground text-[11px] sm:text-xs'>
              模型总数
            </p>
            <p className='text-lg font-semibold tabular-nums sm:text-2xl'>
              {notice.total_model_count}
            </p>
          </div>
        </div>

        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder='搜索模型名称'
        />

        {/* 小屏按视口比例取高，避免固定高度把弹窗顶出屏幕 */}
        <ScrollArea className='h-[45vh] pr-2 sm:h-[320px] sm:pr-3'>
          <div className='space-y-4'>
            <section className='space-y-2'>
              <div className='flex items-center gap-2'>
                <CheckCircle2 className='size-4 text-emerald-600' />
                <h4 className='text-sm font-medium'>
                  你现在可以使用（{filtered.available.length}）
                </h4>
              </div>
              <ModelList
                models={filtered.available}
                variant='available'
                emptyText='没有匹配的可用模型'
              />
            </section>

            <Separator />

            <section className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Lock className='text-muted-foreground size-4' />
                <h4 className='text-sm font-medium'>
                  仅海外网络可访问（{filtered.overseas.length}）
                </h4>
              </div>
              <p className='text-muted-foreground text-xs'>
                以下模型属于未对大陆网络开放的分组，需要海外网络环境才能在网页中使用。
              </p>
              <ModelList
                models={filtered.overseas}
                variant='restricted'
                emptyText='没有匹配的受限模型'
              />
            </section>
          </div>
        </ScrollArea>
      </div>
    </Dialog>
  )
}
