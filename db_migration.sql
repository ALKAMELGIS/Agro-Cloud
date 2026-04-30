
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Locations Master Table
CREATE TABLE locations_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_name VARCHAR(255) NOT NULL,
    country VARCHAR(100) NOT NULL,
    project VARCHAR(255),
    project_id VARCHAR(50),
    zone_id CHAR(3) NOT NULL CHECK (zone_id ~ '^[A-Z0-9]{3}$'),
    code_id CHAR(8) NOT NULL CHECK (code_id ~ '^[A-Z0-9]{8}$'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Geometry Column (EPSG:4326)
    geom GEOMETRY(Geometry, 4326),
    
    -- Metadata
    area_sqm DECIMAL(12, 2),
    geometry_type VARCHAR(20)
);

-- Spatial Index for performance
CREATE INDEX idx_locations_geom ON locations_master USING GIST (geom);

-- Forms Catalog
CREATE TABLE forms_catalog (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

-- Seed Forms
INSERT INTO forms_catalog (id, name) VALUES
('frm_fert', 'Fertigation Management'),
('frm_pest', 'Pest Control'),
('frm_harvest', 'Harvest Logs'),
('frm_scout', 'Field Scouting'),
('frm_irr', 'Irrigation Schedule');

-- Many-to-Many Link Table
CREATE TABLE geo_form_link (
    geo_id UUID REFERENCES locations_master(id) ON DELETE CASCADE,
    form_id VARCHAR(50) REFERENCES forms_catalog(id) ON DELETE CASCADE,
    permissions TEXT[] DEFAULT '{}', -- Array of permissions: 'create', 'read', 'update', 'delete'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (geo_id, form_id)
);

-- Indexes for Link Table
CREATE INDEX idx_geo_form_link_geo ON geo_form_link(geo_id);
CREATE INDEX idx_geo_form_link_form ON geo_form_link(form_id);
