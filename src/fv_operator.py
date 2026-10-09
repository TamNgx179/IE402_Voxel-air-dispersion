"""Constant-coefficient sparse representation of the SAME face-flux FV step.

Precomputes geometry/flux coefficients once, avoiding full-array allocation at
every time step. No implicit solve, alternative boundary condition or clipping.
"""
import numpy as np
from scipy.sparse import coo_matrix


class SparseFVStepper:
    def __init__(self, faces, source, diffusivity, solid, spacing, transport):
        self.source=source.ravel(); self.shape=source.shape; self.transport=transport
        self.volume=float(np.prod(spacing)); self.emission=float(source.sum())*self.volume
        self.solid=solid.ravel(); n=source.size
        ids=np.arange(n).reshape(source.shape)
        diagonal=np.zeros(n); escape=np.zeros(n)
        rows=[]; cols=[]; values=[]
        # Array order z,y,x; face components arrive uf,vf,wf.
        for axis,(velocity,k,d) in enumerate(zip((faces[2],faces[1],faces[0]),diffusivity,spacing)):
            c=np.moveaxis(ids,axis,0); s=np.moveaxis(solid,axis,0); v=np.moveaxis(velocity,axis,0)
            connected=~(s[:-1]|s[1:])
            left=c[:-1][connected]; right=c[1:][connected]; speed=v[1:-1][connected]
            a=(np.maximum(speed,0)+k/d)/d
            b=(np.minimum(speed,0)-k/d)/d
            np.add.at(diagonal,left,-a); np.add.at(diagonal,right,b)
            rows.extend([left,right]); cols.extend([right,left]); values.extend([-b,a])
            for side in (0,-1):
                # Ground closed, other boundaries advective outflow only.
                if axis==0 and side==0: continue
                index=c[side][~s[side]]
                speed=v[side][~s[side]]
                rate=np.maximum(-speed if side==0 else speed,0)/d
                np.add.at(diagonal,index,-rate)
                np.add.at(escape,index,rate*self.volume)
        rows.append(np.arange(n)); cols.append(np.arange(n)); values.append(diagonal)
        self.operator=coo_matrix((np.concatenate(values),(np.concatenate(rows),np.concatenate(cols))),shape=(n,n)).tocsr()
        self.escape=escape

    def step(self, concentration, dt, ledger):
        current=concentration.ravel()
        updated=current+dt*(self.source+self.operator@current)
        ledger['emitted_kg']=ledger.get('emitted_kg',0)+self.emission*dt
        ledger['escaped_kg']=ledger.get('escaped_kg',0)+float(self.escape@current)*dt
        removed=float(updated[self.solid].sum())*self.volume
        ledger['solid_removed_kg']=ledger.get('solid_removed_kg',0)+removed
        updated[self.solid]=0
        tolerance=self.transport.NEGATIVE_RTOL*float(np.max(np.abs(updated),initial=0))
        minimum=float(np.min(updated,initial=0))
        if minimum < -tolerance:
            raise self.transport.NegativeConcentrationError(minimum,tolerance)
        negative=updated<0
        if negative.any():
            ledger['positivity_correction_kg']=ledger.get('positivity_correction_kg',0)-float(updated[negative].sum())*self.volume
            updated[negative]=0
        return updated.reshape(self.shape)
