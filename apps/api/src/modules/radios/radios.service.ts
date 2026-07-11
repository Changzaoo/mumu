import type { RadioStationDto } from '@aurial/shared';
import { NotFoundError } from '../../core/errors/index.js';
import { toRadioDto } from '../shared/mappers.js';
import { radiosRepository } from './radios.repository.js';

export const radiosService = {
  async list(genre?: string): Promise<RadioStationDto[]> {
    const rows = await radiosRepository.list(genre);
    return rows.map(toRadioDto);
  },

  async getById(id: string): Promise<RadioStationDto> {
    const row = await radiosRepository.findById(id);
    if (!row) throw new NotFoundError('Radio station');
    return toRadioDto(row);
  },
};
