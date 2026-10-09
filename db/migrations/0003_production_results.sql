ALTER TABLE artifacts DROP CONSTRAINT artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check CHECK (kind IN
 ('wind','wind_vectors','concentration','columns','metrics','log','config','manifest'));
ALTER TABLE verification_checks DROP CONSTRAINT verification_checks_check_name_check;
ALTER TABLE verification_checks ADD CONSTRAINT verification_checks_check_name_check CHECK (check_name IN
 ('cfl','face_divergence','positivity','wall_flux','mass_balance','sor_convergence','steady_state'));
