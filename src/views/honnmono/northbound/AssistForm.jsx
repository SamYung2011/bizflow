import React, { useState } from 'react';
import { useT } from '../../../i18n.jsx';

const driversForMode = (mode, persons = []) => Array.from({ length: mode === '0+2' ? 2 : 1 }, (_, index) => {
  const { name = '', role = 'driver', idNo } = persons[index] || {};
  return { name, role, idNo };
});

export default function AssistForm({ record, cars, busy, onSave }) {
  const { t } = useT();
  const [applicant, setApplicant] = useState({ name: '', phoneHk: '', addressHk: '', phoneCn: '', ...record.applicant });
  const [vehicle, setVehicle] = useState({ carId: null, plateNo: '', color: '', brand: '', model: '', ...record.vehicle });
  const [driverMode, setDriverMode] = useState(record.driverMode || '1+1');
  const [persons, setPersons] = useState(driversForMode(record.driverMode || '1+1', record.persons));
  const changeMode = mode => { setDriverMode(mode); setPersons(current => driversForMode(mode, current)); };
  return <form onSubmit={event => { event.preventDefault(); onSave({ applicant, vehicle, driverMode, persons }); }}>
    <fieldset className="assist-fields" disabled={busy}>
      <section className="nb-card"><h3>{t('申請人')}</h3><div className="assist-grid">
        {[['name','姓名'],['phoneHk','香港電話'],['phoneCn','內地電話'],['addressHk','香港聯絡地址']].map(([key,label]) => <label className="nb-field" key={key}>
          {t(label)}<input value={applicant[key] || ''} maxLength={key==='addressHk'?2000:key==='name'?255:50} onChange={event => setApplicant({ ...applicant, [key]: event.target.value })} /></label>)}
      </div></section>
      <section className="nb-card"><h3>{t('申請車輛')}</h3><div className="assist-grid">
        <label className="nb-field">{t('使用者名下車輛')}<select aria-label={t('使用者名下車輛')} required value={vehicle.carId || ''} onChange={event => {
          const car = cars.find(row => row.id === Number(event.target.value));
          setVehicle(current => ({ ...current, carId: car?.id || null, plateNo: car?.plate || '', brand: car?.brand || '', model: car?.series || '' }));
        }}><option value="">{t('請選擇')}</option>{cars.map(car => <option key={car.id} value={car.id}>{[car.plate,car.brand,car.series].filter(Boolean).join(' · ')}</option>)}</select></label>
        <label className="nb-field">{t('車牌')}<input maxLength={255} value={vehicle.plateNo || ''} onChange={event => setVehicle({ ...vehicle, plateNo: event.target.value })} /></label>
        <label className="nb-field">{t('車輛顏色')}<input value={vehicle.color || ''} maxLength={100} onChange={event => setVehicle({ ...vehicle, color: event.target.value })} /></label>
      </div>{!cars.length && <p>{t('此使用者尚未新增車輛')}</p>}</section>
      <section className="nb-card"><h3>{t('指定司機配置')}</h3>
        <label className="nb-field">{t('司機模式')}<select aria-label={t('司機模式')} value={driverMode} onChange={event => changeMode(event.target.value)}><option value="1+1">1+1</option><option value="0+2">0+2</option></select></label>
        <div className="assist-grid">{persons.map((person, index) => <label className="nb-field" key={index}>{t('指定司機 {number}', { number: index+1 })}
          <input required maxLength={255} value={person.name} onChange={event => setPersons(current => current.map((row,i) => i===index?{ ...row, name:event.target.value }:row))} /></label>)}</div>
      </section>
      <button className="nb-primary" type="submit" disabled={!cars.some(car => car.id === vehicle.carId)}>{t('儲存並上傳文件')}</button>
    </fieldset>
  </form>;
}
