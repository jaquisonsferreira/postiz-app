'use client';

import { useCalendar, ListStateFilter } from '@gitroom/frontend/components/launches/calendar.context';
import clsx from 'clsx';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import dayjs from 'dayjs';
import { useCallback, useState } from 'react';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { SelectChannels } from '@gitroom/frontend/components/launches/select.channels';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from 'i18next';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { BottomSheet } from '@gitroom/frontend/components/ui/bottom.sheet.component';
import { FilterIcon } from '@gitroom/frontend/components/ui/icons';

// Helper function to get start and end dates based on display type
function getDateRange(
  display: 'day' | 'week' | 'month' | 'list',
  referenceDate?: string
) {
  const date = referenceDate ? newDayjs(referenceDate) : newDayjs();

  switch (display) {
    case 'day':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
    case 'week':
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
    case 'month':
      return {
        startDate: date.startOf('month').format('YYYY-MM-DD'),
        endDate: date.endOf('month').format('YYYY-MM-DD'),
      };
    case 'list':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
  }
}

export const Filters = () => {
  const calendar = useCalendar();
  const t = useT();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Set dayjs locale based on current language
  const currentLanguage = i18next.resolvedLanguage || 'en';
  dayjs.locale();

  // Calculate display date range text, short is the phone version
  const getDisplayText = (short?: boolean) => {
    const startDate = newDayjs(calendar.startDate);
    const endDate = newDayjs(calendar.endDate);

    switch (calendar.display) {
      case 'day':
        return startDate.format(short ? 'ddd (L)' : 'dddd (L)');
      case 'week':
        return `${startDate.format('L')} - ${endDate.format('L')}`;
      case 'month':
        return startDate.format('MMMM YYYY');
      default:
        return '';
    }
  };

  const setToday = useCallback(() => {
    const today = newDayjs();
    const currentRange = getDateRange(
      calendar.display as 'day' | 'week' | 'month'
    );

    // Check if we're already showing today's range
    if (
      calendar.startDate === currentRange.startDate &&
      calendar.endDate === currentRange.endDate
    ) {
      return; // No need to set the same range
    }

    calendar.setFilters({
      startDate: currentRange.startDate,
      endDate: currentRange.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setDay = useCallback(() => {
    // If already in day view and showing today, don't change
    if (calendar.display === 'day') {
      const todayRange = getDateRange('day');
      if (calendar.startDate === todayRange.startDate) {
        return;
      }
    }

    const range = getDateRange('day');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'day',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setWeek = useCallback(() => {
    // If already in week view and showing current week, don't change
    if (calendar.display === 'week') {
      const currentWeekRange = getDateRange('week');
      if (calendar.startDate === currentWeekRange.startDate) {
        return;
      }
    }

    const range = getDateRange('week');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'week',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setMonth = useCallback(() => {
    // If already in month view and showing current month, don't change
    if (calendar.display === 'month') {
      const currentMonthRange = getDateRange('month');
      if (calendar.startDate === currentMonthRange.startDate) {
        return;
      }
    }

    const range = getDateRange('month');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setList = useCallback(() => {
    if (calendar.display === 'list') {
      return;
    }

    const range = getDateRange('list');
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: 'list',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setCustomer = useCallback(
    (customer: string) => {
      if (calendar.customer === customer) {
        return; // No need to set the same customer
      }
      calendar.setFilters({
        startDate: calendar.startDate,
        endDate: calendar.endDate,
        display: calendar.display as 'day' | 'week' | 'month',
        customer: customer,
      });
    },
    [calendar]
  );

  const next = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    let nextStart: dayjs.Dayjs;

    switch (calendar.display) {
      case 'day':
        nextStart = currentStart.add(1, 'day');
        break;
      case 'week':
        nextStart = currentStart.add(1, 'week');
        break;
      case 'month':
        nextStart = currentStart.add(1, 'month');
        break;
      default:
        nextStart = currentStart.add(1, 'week');
    }

    const range = getDateRange(
      calendar.display as 'day' | 'week' | 'month',
      nextStart.format('YYYY-MM-DD')
    );
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const previous = useCallback(() => {
    const currentStart = newDayjs(calendar.startDate);
    let prevStart: dayjs.Dayjs;

    switch (calendar.display) {
      case 'day':
        prevStart = currentStart.subtract(1, 'day');
        break;
      case 'week':
        prevStart = currentStart.subtract(1, 'week');
        break;
      case 'month':
        prevStart = currentStart.subtract(1, 'month');
        break;
      default:
        prevStart = currentStart.subtract(1, 'week');
    }

    const range = getDateRange(
      calendar.display as 'day' | 'week' | 'month',
      prevStart.format('YYYY-MM-DD')
    );
    calendar.setFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      display: calendar.display as 'day' | 'week' | 'month',
      customer: calendar.customer,
    });
  }, [calendar]);

  const setCurrent = useCallback(
    (type: 'day' | 'week' | 'month') => () => {
      if (type === 'day') {
        setDay();
      } else if (type === 'week') {
        setWeek();
      } else if (type === 'month') {
        setMonth();
      }
    },
    [setDay, setWeek, setMonth]
  );

  const isListView = calendar.display === 'list';

  const setListStateFilter = useCallback(
    (next: ListStateFilter) => () => {
      if (calendar.listState === next) return;
      calendar.setListState(next);
    },
    [calendar]
  );

  const listStateOptions: { value: ListStateFilter; label: string }[] = [
    { value: 'all', label: t('all', 'All') },
    { value: 'scheduled', label: t('scheduled', 'Scheduled') },
    { value: 'draft', label: t('draft', 'Draft') },
    { value: 'published', label: t('published', 'Published') },
  ];

  const previousPage = useCallback(() => {
    if (calendar.listPage > 0) {
      calendar.setListPage(calendar.listPage - 1);
    }
  }, [calendar]);

  const nextPage = useCallback(() => {
    if (calendar.listPage < calendar.listTotalPages - 1) {
      calendar.setListPage(calendar.listPage + 1);
    }
  }, [calendar]);

  return (
    <div className="text-textColor flex flex-row flex-wrap gap-[8px] items-center select-none">
      {/* phones: view switcher and filter first, then the date or list row */}
      {!isListView && (
        <div className="flex flex-grow flex-row items-center gap-[10px] mobile:order-3 mobile:basis-full mobile:min-w-0 mobile:gap-[8px]">
          <div className="h-[56px] p-[6px] gap-[4px] flex items-center rounded-full bg-newBgColorInner mobile:flex-1 mobile:min-w-0">
            <button
              type="button"
              aria-label={t('previous', 'Previous')}
              onClick={previous}
              className="cursor-pointer text-textColor rtl:rotate-180 w-[44px] h-[44px] rounded-full flex items-center justify-center hover:bg-newBgColor"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
              >
                <path
                  d="M6.5 11L1.5 6L6.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="min-w-[200px] mobile:min-w-0 mobile:flex-1 text-center h-full flex items-center justify-center">
              <div className="px-[9px] mobile:px-[4px] text-[15px] font-[500] capitalize mobile:truncate">
                <span className="mobile:hidden">{getDisplayText()}</span>
                <span className="hidden mobile:inline">
                  {getDisplayText(true)}
                </span>
              </div>
            </div>
            <button
              type="button"
              aria-label={t('next', 'Next')}
              onClick={next}
              className="cursor-pointer text-textColor rtl:rotate-180 w-[44px] h-[44px] rounded-full flex items-center justify-center hover:bg-newBgColor"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
              >
                <path
                  d="M1.5 11L6.5 6L1.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 mobile:flex-none text-[14px] font-[500]">
            <div className="text-center flex h-[56px]">
              <button
                type="button"
                onClick={setToday}
                className="hover:bg-newBgColor px-[22px] flex justify-center items-center rounded-full transition-all cursor-pointer text-[15px] bg-newBgColorInner"
              >
                {t('today', 'Today')}
              </button>
            </div>
          </div>
        </div>
      )}
      {isListView && (
        <div className="flex flex-grow flex-row items-center gap-[10px] mobile:flex-wrap mobile:order-3 mobile:basis-full mobile:min-w-0 mobile:gap-[8px]">
          <div
            className={clsx(
              'border h-[42px] border-newTableBorder bg-newTableBorder gap-[1px] flex items-center rounded-[8px] overflow-hidden mobile:order-2 mobile:w-full',
              calendar.listTotalPages <= 1 && 'mobile:hidden'
            )}
          >
            <div
              onClick={previousPage}
              className={clsx(
                'text-textColor rtl:rotate-180 px-[9px] mobile:px-0 mobile:w-[36px] bg-newBgColorInner h-full flex items-center justify-center',
                calendar.listPage > 0
                  ? 'cursor-pointer hover:text-textItemFocused hover:bg-boxFocused'
                  : 'opacity-50 cursor-not-allowed'
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
              >
                <path
                  d="M6.5 11L1.5 6L6.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="min-w-[200px] mobile:min-w-0 mobile:flex-1 text-center bg-newBgColorInner h-full flex items-center justify-center">
              <div className="py-[3px] px-[9px] rounded-[5px] transition-all text-[14px]">
                {t('page', 'Page')} {calendar.listPage + 1} {t('of', 'of')} {Math.max(1, calendar.listTotalPages)}
              </div>
            </div>
            <div
              onClick={nextPage}
              className={clsx(
                'text-textColor rtl:rotate-180 px-[9px] mobile:px-0 mobile:w-[36px] bg-newBgColorInner h-full flex items-center justify-center',
                calendar.listPage < calendar.listTotalPages - 1
                  ? 'cursor-pointer hover:text-textItemFocused hover:bg-boxFocused'
                  : 'opacity-50 cursor-not-allowed'
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
              >
                <path
                  d="M1.5 11L6.5 6L1.5 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <div className="flex flex-row p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500] mobile:order-1 mobile:w-full mobile:overflow-x-auto">
            {listStateOptions.map((option) => (
              <div
                key={option.value}
                onClick={setListStateFilter(option.value)}
                className={clsx(
                  'pt-[6px] pb-[5px] cursor-pointer min-w-[80px] px-[12px] text-center rounded-[6px] mobile:flex-1 mobile:min-w-fit mobile:px-[8px] mobile:whitespace-nowrap',
                  calendar.listState === option.value &&
                    'text-textItemFocused bg-boxFocused'
                )}
              >
                {option.label}
              </div>
            ))}
          </div>
          <div className="flex-1 mobile:hidden" />
        </div>
      )}
      {/* phones get a single filter button that opens the filters sheet */}
      <div className="contents mobile:hidden">
        <SelectCustomer
          customer={calendar.customer as string}
          onChange={(customer: string) => setCustomer(customer)}
          integrations={calendar.integrations}
        />
        <SelectChannels />
      </div>
      {calendar.integrations.length > 1 && (
        <div
          onClick={() => setFiltersOpen(true)}
          className={clsx(
            'hidden mobile:flex mobile:order-2 relative w-[42px] h-[42px] rounded-[8px] border justify-center items-center cursor-pointer',
            calendar.selectedChannels
              ? 'border-[#612BD3] text-[#612BD3]'
              : 'border-newTableBorder'
          )}
        >
          <FilterIcon />
          {calendar.selectedChannels && (
            <div className="absolute top-[6px] end-[6px] w-[6px] h-[6px] rounded-full bg-[#612BD3]" />
          )}
        </div>
      )}
      <div className="mobile:order-1 mobile:basis-full mobile:overflow-x-auto">
        <PillTabs
          label={t('calendar_view', 'Calendar view')}
          value={calendar.display}
          onChange={(view) =>
            ({ day: setDay, week: setWeek, month: setMonth, list: setList })[
              view as 'day' | 'week' | 'month' | 'list'
            ]()
          }
          items={[
            { id: 'month', label: t('month', 'Month') },
            { id: 'week', label: t('week', 'Week') },
            { id: 'day', label: t('day', 'Day') },
            { id: 'list', label: t('list', 'List') },
          ]}
        />
      </div>
      {filtersOpen && (
        <BottomSheet
          title={t('select_channels', 'Select Channels')}
          onClose={() => setFiltersOpen(false)}
          button={{
            label: t('done', 'Done'),
            onClick: () => setFiltersOpen(false),
          }}
        >
          <SelectCustomer
            list={true}
            customer={calendar.customer as string}
            onChange={(customer: string) => setCustomer(customer)}
            integrations={calendar.integrations}
          />
          <SelectChannels list={true} />
        </BottomSheet>
      )}
    </div>
  );
};
