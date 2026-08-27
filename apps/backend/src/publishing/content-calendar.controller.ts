import { Controller, Get, Query } from "@nestjs/common";
import { ContentCalendarService } from "./content-calendar.service";

@Controller("calendar")
export class ContentCalendarController {
  constructor(private readonly calendar: ContentCalendarService) {}

  @Get()
  list(@Query("status") status?: string, @Query("provider") provider?: string) {
    return this.calendar.list({ status: status as any, provider });
  }

  @Get("week")
  week(@Query("start") start?: string) {
    const weekStart = start ? new Date(start) : this.currentWeekMonday();
    return this.calendar.getWeek(weekStart);
  }

  private currentWeekMonday(): Date {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
