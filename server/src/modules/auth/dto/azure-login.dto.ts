import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AzureLoginDto {
  /** id_token the SPA received from MSAL (audience = our SSO app registration) */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  idToken!: string;
}
