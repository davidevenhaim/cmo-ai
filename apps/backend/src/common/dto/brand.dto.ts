import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from "class-validator";

export class UpdateBrandDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  voice?: string;

  @IsString()
  @IsOptional()
  audience?: string;
}

export class AddFactDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsString()
  @IsOptional()
  sourceId?: string;
}
