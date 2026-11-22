import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ParseBigIntPipe } from '../../common/pipes/parse-bigint.pipe';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

/** พนักงาน — master data (soft delete). BookingEmployeeRef lets Booking jobs name the team leader. */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('org:read')
  list(@Query() query: QueryEmployeesDto) {
    return this.employees.list(query);
  }

  @Post()
  @RequirePermission('org:manage')
  @Audit('CREATE_EMPLOYEE', 'Employees')
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermission('org:manage')
  @Audit('UPDATE_EMPLOYEE', 'Employees')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('org:manage')
  @Audit('DELETE_EMPLOYEE', 'Employees')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseBigIntPipe) id: bigint): Promise<void> {
    await this.employees.remove(actor, id);
  }
}
